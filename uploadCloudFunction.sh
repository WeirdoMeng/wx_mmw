#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
wechat_cli=${WECHAT_DEVTOOLS_CLI:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}
cloud_env=${1:?用法：sh uploadCloudFunction.sh 云环境ID [开发者工具服务端口]}

shift
if [ "$#" -gt 0 ]; then
  set -- --port "$1"
else
  set --
fi

exec "$wechat_cli" cloud functions deploy --env "$cloud_env" --names mmw \
  --remote-npm-install --project "$project_dir" "$@"
