CREATE TABLE IF NOT EXISTS public.planner_lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  is_default_inbox BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planner_lists_user_id ON public.planner_lists(user_id);

CREATE TABLE IF NOT EXISTS public.planner_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('event', 'task')),
  title TEXT NOT NULL,
  note TEXT,

  start_at TIMESTAMP WITH TIME ZONE,
  end_at TIMESTAMP WITH TIME ZONE,
  is_all_day BOOLEAN DEFAULT FALSE,

  due_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'archived')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),

  list_id UUID,
  remind_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planner_items_user_id ON public.planner_items(user_id);
CREATE INDEX IF NOT EXISTS idx_planner_items_type ON public.planner_items(type);
CREATE INDEX IF NOT EXISTS idx_planner_items_status ON public.planner_items(status);
CREATE INDEX IF NOT EXISTS idx_planner_items_due_at ON public.planner_items(due_at);
CREATE INDEX IF NOT EXISTS idx_planner_items_start_at ON public.planner_items(start_at);
CREATE INDEX IF NOT EXISTS idx_planner_items_list_id ON public.planner_items(list_id);

CREATE TABLE IF NOT EXISTS public.planner_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planner_tags_user_id ON public.planner_tags(user_id);

CREATE TABLE IF NOT EXISTS public.planner_item_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  item_id UUID NOT NULL,
  tag_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, item_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_item_tags_user_id ON public.planner_item_tags(user_id);
CREATE INDEX IF NOT EXISTS idx_planner_item_tags_item_id ON public.planner_item_tags(item_id);
CREATE INDEX IF NOT EXISTS idx_planner_item_tags_tag_id ON public.planner_item_tags(tag_id);

GRANT SELECT ON public.planner_lists TO anon;
GRANT SELECT ON public.planner_items TO anon;
GRANT SELECT ON public.planner_tags TO anon;
GRANT SELECT ON public.planner_item_tags TO anon;

GRANT ALL PRIVILEGES ON public.planner_lists TO authenticated;
GRANT ALL PRIVILEGES ON public.planner_items TO authenticated;
GRANT ALL PRIVILEGES ON public.planner_tags TO authenticated;
GRANT ALL PRIVILEGES ON public.planner_item_tags TO authenticated;
