-- Create index on FK user_id for tasks assigned to
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks (assigned_to);

-- Create index on FK created_by for tasks
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON public.tasks (created_by);

-- Create index on org id for tasks
CREATE INDEX IF NOT EXISTS idx_tasks_org_id ON public.tasks (organisation_id);

-- Create index on FK user_id for audit logs
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.audit_log (user_id);

-- Create index on FK task_id for audit logs
CREATE INDEX IF NOT EXISTS idx_audit_log_task_id ON public.audit_log (task_id);

-- Create index on FK user_id for todos
CREATE INDEX IF NOT EXISTS idx_todos_user_id ON public.todos (user_id);

-- Create index on FK task_id for task comments
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON public.task_comments (task_id);

-- Create index on FK user_id for task comments
CREATE INDEX IF NOT EXISTS idx_task_comments_user_id ON public.task_comments (user_id);

-- Create index on FK organisation_id for users
CREATE INDEX IF NOT EXISTS idx_users_org_id ON public.users (organisation_id);
