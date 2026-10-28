@echo off
rem Пересборка трей-приложения после правок kinozal-tray.cs
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /out:"%~dp0kinozal-tray.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Management.dll "%~dp0kinozal-tray.cs"
if %errorlevel%==0 (echo BUILD OK) else (echo BUILD FAIL)
pause
