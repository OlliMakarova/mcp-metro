#!/bin/bash

set +e
rm -rf node_modules/
yarn install --frozen-lockfile
if [[ -n "$1" ]]; then
  read -p "Press any key to resume ..."
fi;
