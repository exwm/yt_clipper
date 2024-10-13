fetch_tags:
  git fetch origin --tags --force

poetry_sync:
  poetry lock --no-update && poetry install --sync

pr pr_number:
    git fetch -fu origin refs/pull/{{pr_number}}/head:pr/{{pr_number}}
    git checkout pr/{{pr_number}}
