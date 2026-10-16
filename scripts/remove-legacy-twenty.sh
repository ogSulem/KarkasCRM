#!/usr/bin/env bash
# Убирает из репозитория исторический монорепозиторий Twenty CRM (packages/, ~312 МБ, ~25 000 файлов).
# KarkasCRM от него не зависит: backend, frontend, тесты и Docker-сборка самодостаточны.
#
# Запускать в клоне репозитория:   ./scripts/remove-legacy-twenty.sh
# Файлы остаются в истории git — при желании можно вернуть из предыдущего коммита.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d packages ]; then
  echo "Каталога packages/ уже нет — чистить нечего."
  exit 0
fi

SIZE=$(du -sh packages | cut -f1)
FILES=$(git ls-files packages | wc -l | tr -d ' ')
echo "Удаляем packages/ (Twenty CRM): ${SIZE}, ${FILES} файлов в git."

git rm -r --quiet packages
git -c user.name="KarkasCRM" -c user.email="dev@localhost" commit --quiet -m "chore: убрать исторический монорепозиторий Twenty CRM (не используется KarkasCRM)"

echo "Готово. Проверьте:  git status  &&  ls"
echo "Сборка Docker от этого не менялась (packages/ и так был в .dockerignore)."
echo
echo "LICENSE (AGPL-3.0 от Twenty) намеренно не трогаем — решение о лицензии вашего проекта за вами."
