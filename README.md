# Puzzle Ink

Спільний оверлей для малювання поверх гри або стріму. Один учасник запускає сервер і тунель Cloudflare в застосунку. Решта підключається до тієї самої сесії. Учасники бачать штрихи одне одного й можуть стирати свої.

Підтримувані платформи — Windows x64 із WebView2 та Linux x86_64 з X11. Для прозорого оверлею в i3 потрібен композитор, наприклад picom.

## Структура

- `src/` — Rust-застосунок на Tauri 2, керування оверлеєм, глобальні клавіші та WebSocket-сервер.
- `frontend/` — панель і оверлей на HTML, CSS та JavaScript. Tauri вбудовує ці файли безпосередньо у виконуваний файл.
- `icons/` — іконки застосунку.
- `scripts/` — підготовка приватної збірки й пакування EXE, Linux-архіву та Flatpak.
- `tests/frontend/` — тести логіки малювання й хоткеїв. Rust-тести розташовані поруч із кодом у `src/`.

## Збирання

Потрібні Rust, Python 3.9+ та [системні залежності Tauri](https://v2.tauri.app/start/prerequisites/) для вашої платформи. Команди виконуються з кореня репозиторію.

1. Для першої збірки задайте `TUNNEL_TOKEN` у середовищі або у файлі `.env` в корені. Для наявної сесії використовуйте її приватний `.runtime/personal-session.json`. Усі збірки однієї сесії мають використовувати той самий `accessKey`.
2. Підготуйте конфігурацію та завантажте перевірений `cloudflared` для платформи збірки.

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
flatpak install --user ./dist/Puzzle-Ink-Tauri-0.96.0-linux-x64.flatpak
flatpak run art.critfail.puzzleink.pilot
```

**Готові пакети містять ключ сесії та токен тунелю.** Передавайте їх учасникам приватно. Git ігнорує `.env`, `.runtime/`, `target/` та `dist/`.
