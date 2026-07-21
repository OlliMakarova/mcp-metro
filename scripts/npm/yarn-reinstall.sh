#!/bin/bash

set +e
rm -rf node_modules/
if [ -f "yarn.lock" ]; then rm yarn.lock; fi;
yarn install
if [[ -n "$1" ]]; then
  read -p "Press any key to resume ..."
fi;

