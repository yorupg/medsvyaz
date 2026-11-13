Исправление скрипта пересчёта предложений Калининградской области.
Удалён абсолютный путь /mnt/data/...; корень проекта определяется как родитель папки scripts.

Установка из корня проекта (папки с package.json):
  unzip -o ~/Downloads/MedSvyaz24_Kaliningrad_Rankings_Path_FIX.zip
  python scripts/build_kaliningrad_rankings_v62.py

Если после этого появится FileNotFoundError для data/processed/kaliningrad-pilot.json.br,
проверьте, что в корне проекта действительно существует исходный набор данных.
Его нет в этом небольшом патче: он должен быть в исходной полной версии сайта.
