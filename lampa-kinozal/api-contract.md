# Контракт локального API

Плагин работает с двумя независимыми endpoint-ами. Оба адреса задаются вручную в настройках LAMPA.

## Поиск

`GET {proxy}/v1/search?q={urlencoded query}&page={number}&limit={number}`

Ответ:

```json
{
  "page": 1,
  "total_pages": 1,
  "results": [
    {
      "id": "knz-123",
      "title": "Название раздачи",
      "original_title": "Original title",
      "year": 2024,
      "type": "movie",
      "poster": "https://example.invalid/poster.jpg",
      "overview": "Короткое описание",
      "quality": "1080p",
      "codec": "H.264",
      "audio": "Русский AC3 5.1",
      "size": "8.4 GB",
      "duration": "02:01:00",
      "seeds": 42,
      "peers": 3,
      "published_at": "2026-10-27",
      "magnet": "magnet:?xt=urn:btih:..."
    }
  ]
}
```

Обязательны только `id`, `title` и `magnet`. Остальные поля могут отсутствовать. Прокси должен возвращать нормализованный JSON и не включать пароль, cookie или токен в ответ.

## Передача в TorrServe/TorrServer

`POST {torr_endpoint}/v1/torrents`

Поля формы:

- `magnet` — magnet выбранной раздачи;
- `title` — отображаемое название;
- `poster` — безопасный URL постера или пустая строка.

Ожидаемый ответ:

```json
{ "ok": true, "message": "Добавлено" }
```

Плагин отправляет запрос только после действия пользователя. Если endpoint пустой или magnet не проходит проверку, запрос не выполняется.

