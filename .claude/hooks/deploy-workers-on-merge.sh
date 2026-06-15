#!/bin/bash
# Auto-deploy workers after gh pr merge, based on which directories changed.
# Triggered by PostToolUse on Bash commands matching "gh pr merge".

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# Double-check this is a merge command (the `if` filter in settings handles most skips)
echo "$cmd" | grep -q 'gh pr merge' || exit 0

# Extract PR number from the command args (e.g. "gh pr merge 275 --merge")
pr_num=$(echo "$cmd" | grep -oE 'gh pr merge\s+([0-9]+)' | grep -oE '[0-9]+$')

# If no explicit number, try to pull it from the response output ("Merged pull request #275")
if [ -z "$pr_num" ]; then
  response=$(echo "$input" | jq -r '
    if (.tool_response | type) == "string" then .tool_response
    elif .tool_response.output then .tool_response.output
    else (.tool_response | tostring)
    end // ""' 2>/dev/null)
  pr_num=$(echo "$response" | grep -oE '#([0-9]+)' | head -1 | tr -d '#')
fi

[ -z "$pr_num" ] && exit 0

# Fetch changed file paths for this PR
files=$(gh pr view "$pr_num" --json files --jq '.files[].path' 2>/dev/null) || exit 0
[ -z "$files" ] && exit 0

# Deploy each worker whose directory appears in the diff
if echo "$files" | grep -q '^comms-worker/'; then
  echo "▶ Deploying comms-worker (PR #$pr_num touched comms-worker/)..."
  npm run deploy:comms-worker
fi
if echo "$files" | grep -q '^pipeline-worker/'; then
  echo "▶ Deploying pipeline-worker (PR #$pr_num touched pipeline-worker/)..."
  npm run deploy:worker
fi
if echo "$files" | grep -q '^ai-worker/'; then
  echo "▶ Deploying ai-worker (PR #$pr_num touched ai-worker/)..."
  npm run deploy:ai-worker
fi
if echo "$files" | grep -q '^ai-cron-worker/'; then
  echo "▶ Deploying ai-cron-worker (PR #$pr_num touched ai-cron-worker/)..."
  npm run deploy:ai-cron
fi
if echo "$files" | grep -q '^higgs-worker/'; then
  echo "▶ Deploying higgs-worker (PR #$pr_num touched higgs-worker/)..."
  npm run deploy:higgs-worker
fi
if echo "$files" | grep -q '^geo-fingerprint-worker/'; then
  echo "▶ Deploying geo-fingerprint-worker (PR #$pr_num touched geo-fingerprint-worker/)..."
  npm run deploy:geo-fingerprint-worker
fi

exit 0
