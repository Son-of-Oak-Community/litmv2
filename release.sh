#! /bin/sh

VERSION=$(jq -r '.version' system.json)

git checkout --detach HEAD

jq --tab --arg version "$VERSION" \
  '.manifest = "https://raw.githubusercontent.com/Son-of-Oak-Community/litmv2/refs/heads/v14/system.json" |
   .download = "https://github.com/Son-of-Oak-Community/litmv2/archive/refs/tags/v" + $version + ".zip"' \
  system.json > temp.json
mv temp.json system.json

git commit -am "chore(release): v$VERSION"
git tag "v$VERSION" -m "v$VERSION"

git push origin HEAD:v14 --follow-tags --force-with-lease
git push origin "v$VERSION"

git checkout main
