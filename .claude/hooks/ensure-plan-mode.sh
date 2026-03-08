#!/bin/bash
# UserPromptSubmit hook: 提醒 Claude 对非 trivial 任务先进入 Plan Mode

cat << 'EOF'
IMPORTANT: Before responding to this request, evaluate whether it is a non-trivial task.
If the task involves ANY of the following, you MUST call the EnterPlanMode tool FIRST before doing any analysis or implementation:
- Changes to 3 or more files
- New features or new API endpoints
- Architecture changes or refactoring
- Changes to business logic or data flow

Do NOT skip EnterPlanMode for non-trivial tasks. Call it as your very first action.
EOF
