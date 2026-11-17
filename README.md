# Puzzle Ink

Спільний оверлей для малювання поверх гри або стріму. Один учасник запускає сервер і тунель Cloudflare в застосунку. Решта підключається до тієї самої сесії. Учасники бачать штрихи одне одного й можуть стирати свої.

Платформи — Windows x64 із WebView2, Linux x86_64 з X11 і Mac з Apple Silicon (macOS 14+). Для прозорого оверлею в i3 потрібен композитор, наприклад picom. Mac підключається до сесії для спільного малювання. Сервер запускає учасник на Windows або Linux.

## Структура

- `src/` — Rust-застосунок на Tauri 2, керування оверлеєм, глобальні клавіші та WebSocket-сервер.
- `frontend/` — панель і оверлей на HTML, CSS та JavaScript. Tauri вбудовує ці файли безпосередньо у виконуваний файл.
- `icons/` — іконки застосунку.
- `scripts/` — підготовка приватної збірки й пакування EXE, Linux-архіву та Flatpak.
- `tests/frontend/` — тести логіки малювання й хоткеїв. Rust-тести розташовані поруч із кодом у `src/`.

## Збирання

Потрібні Rust, Python 3.9+ та [системні залежності Tauri](https://v2.tauri.app/start/prerequisites/) для вашої платформи. Команди виконуються з кореня репозиторію.

1. На Windows/Linux для першої збірки задайте `TUNNEL_TOKEN` у середовищі або у файлі `.env` в корені. Для наявної сесії використовуйте її приватний `.runtime/personal-session.json`. На Mac скопіюйте лише `.runtime/client-session.json`, який готує цей скрипт на ПК хоста, або задайте `PUZZLE_INK_ACCESS_KEY` з ключем тієї самої сесії.
2. Підготуйте конфігурацію. На Windows і Linux скрипт також завантажить перевірений `cloudflared`.

   ```sh
   python scripts/prepare.py
   ```

3. Запустіть тести та зберіть застосунок.

   ```sh
   cargo test --locked
   cargo build --release --locked
   ```

Для запуску з вихідного коду використовуйте `cargo run --locked`. Тести інтерфейсу запускаються окремо через `node --test tests/frontend/*.test.mjs` (Node.js 22+). На Linux для Python можна використовувати команду `python3`.

## Пакети

`python scripts/package.py` кладе готовий пакет у `dist/`. На Windows це один EXE з вбудованим тунелем. На Linux це архів із застосунком та `cloudflared` поруч.

Для Flatpak виконайте `bash scripts/package-flatpak.sh` на Linux після release-збірки. Встановлення і запуск готового пакета:

```sh
flatpak install --user ./dist/Puzzle-Ink-Tauri-0.96.1-linux-x64.flatpak
flatpak run art.critfail.puzzleink.pilot
```

### Застосунок для Mac

На Mac з Apple Silicon, Xcode Command Line Tools і Rust скопіюйте файл клієнтської конфігурації до `.runtime/client-session.json`, потім виконайте з кореня проєкту:

```sh
python3 scripts/prepare.py
MACOSX_DEPLOYMENT_TARGET=14.0 cargo build --release --locked
python3 scripts/package.py
```

У `dist/` з’явиться ZIP із локально підписаним (ad hoc) `Puzzle Ink.app`. Розпакуйте його й перенесіть застосунок у «Програми». Для глобальних хоткеїв надайте Puzzle Ink дозвіл у «Системні параметри → Приватність і безпека → Моніторинг вводу». Якщо macOS попросить перезапуск, закрийте застосунок через ⌘Q та відкрийте знову. Панель і кнопки оверлею доступні й без дозволу на хоткеї.

**Усі приватні пакети містять ключ сесії.** Лише збірки з функцією сервера також містять токен тунелю. Передавайте їх учасникам приватно. Git ігнорує `.env`, `.runtime/`, `target/` та `dist/`.
