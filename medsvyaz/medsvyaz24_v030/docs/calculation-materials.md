# Расчётные материалы · 0.3.0

Текущий исследовательский паспорт: [RESEARCH.md](RESEARCH.md). Команды запуска: [README](../README.md).

- `data/processed/{kaliningrad,ivanovo,pskov}-pilot.json` — три модели на реальных исходниках
- `data/processed/synthetic-regions.json` — 86 сценарных моделей с условной сетью
- `data/derived/study-summary.json` — базовые результаты89 наборов, сценарии и чувствительность трёх пилотов
- `data/derived/{pilot,ivanovo,pskov}-independent-check.json` — независимая SciPy-проверка
- `data/derived/{pilot,ivanovo,pskov}-calculation.csv` — рассчитанные времена по поселениям
- `data/derived/synthetic-calibration.json` — параметры калибровки
- `data/raw/{pilot,ivanovo,pskov}` — переписные строки, PBF, подтверждённые адреса и исходные документы
- `data/raw/synthetic-samples.json` — отобранные строки для генератора
- `data/sources.json` — реестр источников, лицензии и ограничения

Веб-выгрузки продублированы в `public/downloads`, полные наборы выдаёт API `/api/study/:id/dataset`. Python для обычного запуска не нужен.

Старые семь-точечные примеры `data/examples` сохранены для обратной совместимости и тестов, не используются как современные региональные результаты. Реальные и синтетические результаты никогда не объединяются в национальную оценку.
