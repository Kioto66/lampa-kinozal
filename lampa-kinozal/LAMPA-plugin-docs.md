# Документация LAMPA для разработки плагинов

Основной официальный раздел:

- [Руководство по разработке плагинов LAMPA (русский)](https://github.com/yumata/lampa-source/tree/main/docs/ru)
- [README руководства](https://github.com/yumata/lampa-source/blob/main/docs/ru/README.md)
- [English version](https://github.com/yumata/lampa-source/tree/main/docs/en)

## Разделы руководства

1. [Обзор и структура файлов](https://github.com/yumata/lampa-source/blob/main/docs/ru/01-getting-started.md)
2. [Жизненный цикл](https://github.com/yumata/lampa-source/blob/main/docs/ru/02-lifecycle.md)
3. [Система событий](https://github.com/yumata/lampa-source/blob/main/docs/ru/03-events.md)
4. [Хранилище и сеть](https://github.com/yumata/lampa-source/blob/main/docs/ru/04-storage-network.md)
5. [Шаблоны и локализация](https://github.com/yumata/lampa-source/blob/main/docs/ru/05-templates-lang.md)
6. [UI-компоненты](https://github.com/yumata/lampa-source/blob/main/docs/ru/06-ui-components.md)
7. [Навигация](https://github.com/yumata/lampa-source/blob/main/docs/ru/07-navigation.md)
8. [API настроек](https://github.com/yumata/lampa-source/blob/main/docs/ru/08-settings.md)
9. [Манифест и меню](https://github.com/yumata/lampa-source/blob/main/docs/ru/09-manifest-menu.md)
10. [Интеграция с плеером](https://github.com/yumata/lampa-source/blob/main/docs/ru/10-player.md)
11. [Типичные ошибки](https://github.com/yumata/lampa-source/blob/main/docs/ru/11-pitfalls.md)
12. [Отладка и логирование](https://github.com/yumata/lampa-source/blob/main/docs/ru/12-debug.md)
13. [Controller и TV-навигация](https://github.com/yumata/lampa-source/blob/main/docs/ru/13-controller.md)

## Что читать для `lampa-kinozal`

- старт и защита от двойной загрузки — разделы 1–2;
- сетевые запросы и локальное хранилище — раздел 4;
- экран поиска, фокус и возврат назад — разделы 6–7 и 13;
- настройки proxy/TorrServer — раздел 8;
- пункт «Кинозал» в меню — раздел 9;
- жизненный цикл и отмена запросов — разделы 2 и 4.

Ссылки оставлены на ветку `main` официального репозитория `yumata/lampa-source`, поэтому содержимое может обновляться. Локальный прототип находится в `plugin.js`; этот файл является навигацией по первоисточнику, а не копией документации.

