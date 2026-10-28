// Кинозал для LAMPA — трей-управление.
// Иконка в трее: статус (сервер / Chrome), запуск и остановка из меню.
// Сборка: csc /target:winexe /out:kinozal-tray.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Management.dll kinozal-tray.cs

using System;
using System.Diagnostics;
using System.Drawing;
using System.Management;
using System.Net;
using System.Threading;
using System.Windows.Forms;

namespace KinozalTray
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            bool created;
            var mutex = new Mutex(true, "KinozalTray.SingleInstance", out created);
            if (!created) return;

            Application.EnableVisualStyles();
            Application.Run(new TrayContext());
        }
    }

    class TrayContext : ApplicationContext
    {
        readonly string appDir = AppDomain.CurrentDomain.BaseDirectory;
        readonly string chrome = @"C:\Program Files\Google\Chrome\Application\chrome.exe";
        readonly string profileName = ".kinozal-manual-profile";

        NotifyIcon tray;
        System.Windows.Forms.Timer timer;
        ToolStripMenuItem miStatus, miStart, miStop;
        bool serverUp, chromeUp;
        Process nodeProcess;

        public TrayContext()
        {
            var menu = new ContextMenuStrip();

            miStatus = new ToolStripMenuItem("Статус: проверяю…", null, (s, e) => ShowStatus());
            miStart = new ToolStripMenuItem("Запустить всё", null, (s, e) => StartAll());
            miStop = new ToolStripMenuItem("Остановить всё", null, (s, e) => StopAll());
            var miOpen = new ToolStripMenuItem("Открыть окно Chrome", null, (s, e) => RestoreChrome());
            var miExit = new ToolStripMenuItem("Выход", null, (s, e) => ExitTray());

            menu.Items.Add(miStatus);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(miStart);
            menu.Items.Add(miStop);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(miOpen);
            menu.Items.Add(miExit);

            tray = new NotifyIcon
            {
                Icon = SystemIcons.Application,
                Text = "Кинозал: проверяю…",
                ContextMenuStrip = menu,
                Visible = true
            };
            tray.DoubleClick += (s, e) => ShowStatus();

            timer = new System.Windows.Forms.Timer { Interval = 5000 };
            timer.Tick += (s, e) => CheckState();
            timer.Start();

            // Одна кнопка: при запуске трея сразу поднимаем всё, что не работает
            ThreadPool.QueueUserWorkItem(_ =>
            {
                if (!Ping("http://127.0.0.1:8787/health")) { StartChrome(); StartServer(); }
                CheckState();
            });
        }

        bool Ping(string url)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 2000;
                req.GetResponse().Close();
                return true;
            }
            catch { return false; }
        }

        void CheckState()
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                bool s = Ping("http://127.0.0.1:8787/health");
                bool c = Ping("http://127.0.0.1:9222/json/version");
                BeginUpdate(s, c);
            });
        }

        void BeginUpdate(bool s, bool c)
        {
            try { tray.ContextMenuStrip.BeginInvoke((MethodInvoker)delegate { ApplyState(s, c); }); }
            catch { }
        }

        void ApplyState(bool s, bool c)
        {
            bool changed = (s != serverUp || c != chromeUp);
            serverUp = s; chromeUp = c;

            string text = "Кинозал: сервер " + (s ? "работает" : "не запущен") +
                          ", Chrome " + (c ? "открыт" : "закрыт");
            tray.Text = text.Length > 63 ? text.Substring(0, 63) : text;
            miStatus.Text = text;

            if (changed)
                tray.ShowBalloonTip(1500, "Кинозал", text, ToolTipIcon.Info);
        }

        void StartChrome()
        {
            if (chromeUp) return;
            var psi = new ProcessStartInfo
            {
                FileName = chrome,
                Arguments = "--remote-debugging-port=9222 --user-data-dir=\"" +
                             System.IO.Path.Combine(appDir, profileName) +
                             "\" --no-first-run --no-default-browser-check --window-size=1280,900 https://kinozal.me/",
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Minimized
            };
            Process.Start(psi);
            for (int i = 0; i < 15 && !Ping("http://127.0.0.1:9222/json/version"); i++) Thread.Sleep(1000);
        }

        void StartServer()
        {
            if (serverUp) return;
            var psi = new ProcessStartInfo
            {
                FileName = "node.exe",
                Arguments = "api-server.js",
                WorkingDirectory = appDir,
                UseShellExecute = false,
                CreateNoWindow = true // окно сервера вообще не появляется
            };
            psi.EnvironmentVariables["LAMPA_API_SOURCE"] = "browser";
            psi.EnvironmentVariables["KINOZAL_CDP_URL"] = "http://127.0.0.1:9222";
            nodeProcess = Process.Start(psi);
            for (int i = 0; i < 15 && !Ping("http://127.0.0.1:8787/health"); i++) Thread.Sleep(1000);
        }

        void StartAll()
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                StartChrome();
                StartServer();
                CheckState();
            });
        }

        void StopAll()
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                KillByCommand("node.exe", "api-server");
                KillByCommand("chrome.exe", profileName);
                nodeProcess = null;
                CheckState();
            });
        }

        void KillByCommand(string exe, string marker)
        {
            try
            {
                var query = new SelectQuery("Win32_Process", "Name = '" + exe + "'");
                using (var searcher = new ManagementObjectSearcher(query))
                    foreach (var proc in searcher.Get())
                    {
                        var cmdline = (proc["CommandLine"] as string) ?? "";
                        if (cmdline.IndexOf(marker, StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            var id = Convert.ToInt32(proc["ProcessId"]);
                            try { Process.GetProcessById(id).Kill(); } catch { }
                        }
                    }
            }
            catch { }
        }

        void RestoreChrome()
        {
            try
            {
                var query = new SelectQuery("Win32_Process", "Name = 'chrome.exe'");
                using (var searcher = new ManagementObjectSearcher(query))
                    foreach (var proc in searcher.Get())
                    {
                        var cmdline = (proc["CommandLine"] as string) ?? "";
                        if (cmdline.IndexOf(profileName, StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            var p = Process.GetProcessById(Convert.ToInt32(proc["ProcessId"]));
                            if (p.MainWindowHandle != IntPtr.Zero)
                                ShowWindow(p.MainWindowHandle, 9); // SW_RESTORE
                            return;
                        }
                    }
            }
            catch { }
            StartChrome();
        }

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        void ShowStatus()
        {
            CheckState();
            tray.ShowBalloonTip(2000, "Кинозал", tray.Text, ToolTipIcon.Info);
        }

        void ExitTray()
        {
            tray.Visible = false;
            Application.Exit();
        }
    }
}
