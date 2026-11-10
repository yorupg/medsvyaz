# Загрузка финального проекта на GitHub

Финальная методика: МИЭД v4.0, τ=30, одинаковые веса поселений. Для сдачи используйте `submission/medsvyaz-final.zip`. Архив содержит рабочий код, 85 подготовленных наборов, расчёты, тесты, паспорт и инструкции. Он не содержит установленные зависимости, сборку, локальные SQLite-файлы и тяжёлые первичные выгрузки. Исходная рабочая папка не очищается.

## Почему не нужно загружать все 2 ГБ

Основной объём занимают `data/raw` (около 1,3 ГБ), `node_modules` и повторяемая сборка `dist`. Они не нужны в репозитории для запуска подготовленного сайта. Три исходных графа включены без потерь в `.json.gz`; сервер читает их автоматически. Ещё 30 графов также уже сжаты. URL, контрольные суммы источников и журналы координат сохраняются.

GitHub блокирует обычные Git-файлы более 100 MiB. В подготовленном комплекте каждый файл меньше этого порога; Git LFS для этого комплекта не требуется. Сам ZIP нельзя добавлять в Git как один файл: он крупнее лимита. Заливайте распакованные файлы через Git. Официальные правила: [размеры файлов](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github), [импорт локального кода](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github).

## Порядок действий

1. Распакуйте `medsvyaz-final.zip` в отдельную папку. Внутри будет `medsvyaz-final`. Откройте именно её в VS Code / терминале. Не создавайте репозиторий внутри старой папки на 2 ГБ: отдельный подготовленный комплект проще проверить.
2. На GitHub создайте пустой репозиторий, например `medsvyaz24`. Не добавляйте автоматически README, `.gitignore` или лицензию: эти файлы уже подготовлены. Выберите видимость согласно правилам чемпионата.
3. Установите Git, если его ещё нет. На macOS `git --version` при необходимости предложит установить Command Line Tools. Команды ниже выполняются в распакованной папке:

```bash
cd /путь/к/medsvyaz-final

git init -b main
git add .
git status --short
git diff --cached --stat
git commit -m "Final release: MedSvyaz 24/7, MIED v4"
```

Если Git попросит имя и почту, задайте их для этого репозитория и повторите commit:

```bash
git config user.name "Ваше имя"
git config user.email "Ваш email или GitHub noreply"
```

4. Скопируйте HTTPS-адрес созданного репозитория. Замените `YOUR-USERNAME` на свой логин:

```bash
git remote add origin https://github.com/YOUR-USERNAME/medsvyaz24.git
git push -u origin main
```

Авторизацию выполняйте через браузер, GitHub Desktop или персональный токен при запросе Git. Пароль аккаунта не используется как пароль для Git HTTPS. Не вставляйте токен в URL или файлы проекта.

5. Откройте репозиторий на GitHub и проверьте наличие `src`, `server`, `shared`, `data/processed`, `data/derived`, `package-lock.json`, `README.md` и PDF-паспорта в `docs`. Репозиторий должен содержать распакованные файлы, а не ZIP и не одну папку `node_modules`.
6. Создайте GitHub Release с тегом `v1.0.0`. В описание внесите: «МИЭД v4.0; τ=30; вес каждого поселения 1; 33 реальных набора и 52 модели». Отдельно можно приложить PDF-паспорт и ZIP комплекта как Release assets. Не добавляйте сам ZIP в Git-коммит.

Если удобнее GitHub Desktop: после распаковки выберите **File → Add local repository**, создайте репозиторий в этой папке, выполните **Commit to main → Publish repository**. Загружать сотни мегабайт через веб-форму отдельных файлов не нужно.

## Проверка после скачивания

Нужен Node.js не ниже 22.13:

```bash
npm ci
npm run build
npm start
```

Открыть http://localhost:5180. Если порт уже занят:

```bash
npm start -- --port 5181
```

Без установленного Node можно использовать Docker Desktop:

```bash
docker compose up --build
```

Данные уже подготовлены, для обычного запуска Python не нужен. Интернет нужен для `npm ci` и фоновых плиток OSM; контуры, точки, маршруты и движок хранятся локально. Один GitHub-репозиторий не запускает Node API: GitHub Pages подходит для статических сайтов, а этот проект требует Node/Docker-хостинг.

## Воспроизводимость расчётов

```bash
npm run calculate
python3 scripts/verify_v4.py
python3 scripts/export_v4.py
npm test
npm run verify
npm run build
```

Независимые маршрутные времена Python/SciPy сохранены в `data/derived`, а контрольный Python-скрипт повторяет агрегирование v4 из времён каждой точки. Полный повтор сбора первичных PBF потребует отдельных сетевых загрузок и Python-зависимостей из `requirements-data.txt`. Старые скрипты подготовки исходных пилотов читают несжатые JSON; при необходимости восстановите их командой `python3 scripts/unpack_pilots.py`. Для обычного запуска, пересчёта v4 и тестов это не требуется.

Для пересоздания паспорта: `node --import tsx scripts/passport-data.ts`, затем `node scripts/build-passport.mjs`. Нужен Chrome; на другой ОС установите Chromium командой `npx playwright install chromium` или задайте путь `CHROME_PATH`.

## Итоговые документы

- `docs/Паспорт_проекта_МедСвязь_24_7.pdf` — 3 страницы для жюри.
- `docs/DATA_AUDIT_2026-11-10.md` — текущая методика и таблица 33 регионов до/после.
- `data/derived/v4-independent-checks.json` — независимая проверка 85 результатов.
- `public/downloads/map-consistency-audit.json` — сверка полного графа и карт, включая сценарии.
- `SUBMISSION_MANIFEST.json` — состав комплекта и SHA-256 файлов. Манифест описывает файлы в момент упаковки; не редактируйте данные после финальной сдачи без новой версии.
