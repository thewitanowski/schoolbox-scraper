-- Scrape run tracking
CREATE TABLE scrape_runs (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  error_message TEXT,
  timetable_count INTEGER DEFAULT 0,
  due_work_count INTEGER DEFAULT 0,
  grades_count INTEGER DEFAULT 0,
  feed_count INTEGER DEFAULT 0,
  schedules_count INTEGER DEFAULT 0
);

-- Subjects discovered from scraping
CREATE TABLE schoolbox_subjects (
  id SERIAL PRIMARY KEY,
  schoolbox_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  teacher TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Timetable periods
CREATE TABLE schoolbox_timetable (
  id SERIAL PRIMARY KEY,
  scrape_run_id INTEGER NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  day_name TEXT NOT NULL,
  week TEXT NOT NULL CHECK (week IN ('A', 'B')),
  period_label TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  subject_code TEXT NOT NULL,
  room TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_timetable_scrape ON schoolbox_timetable(scrape_run_id);
CREATE INDEX idx_timetable_day ON schoolbox_timetable(day_name, week);

-- Due work / assessments
CREATE TABLE schoolbox_due_work (
  id SERIAL PRIMARY KEY,
  scrape_run_id INTEGER NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  schoolbox_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subject TEXT,
  subject_code TEXT,
  type TEXT,
  due_date TEXT,
  status TEXT,
  weighting TEXT,
  description TEXT,
  criteria TEXT,
  materials TEXT,
  terminology TEXT,
  ai_policy TEXT,
  teacher TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_due_work_scrape ON schoolbox_due_work(scrape_run_id);
CREATE INDEX idx_due_work_subject ON schoolbox_due_work(subject_code);

-- Grade entries (per-subject assessment results)
CREATE TABLE schoolbox_grades (
  id SERIAL PRIMARY KEY,
  scrape_run_id INTEGER NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  subject_code TEXT NOT NULL,
  teacher TEXT,
  assessment_name TEXT NOT NULL,
  status TEXT,
  type TEXT,
  due_date TEXT,
  grade TEXT,
  feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subject_code, assessment_name)
);

CREATE INDEX idx_grades_scrape ON schoolbox_grades(scrape_run_id);
CREATE INDEX idx_grades_subject ON schoolbox_grades(subject_code);

-- Student feed items
CREATE TABLE schoolbox_feed (
  id SERIAL PRIMARY KEY,
  scrape_run_id INTEGER NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  feed_date TEXT NOT NULL,
  title TEXT NOT NULL,
  teacher TEXT,
  subject TEXT,
  time TEXT,
  grade TEXT,
  feedback TEXT,
  detail_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (title, feed_date, subject)
);

CREATE INDEX idx_feed_scrape ON schoolbox_feed(scrape_run_id);
CREATE INDEX idx_feed_date ON schoolbox_feed(feed_date);

-- Assessment schedule PDFs
CREATE TABLE schoolbox_schedules (
  id SERIAL PRIMARY KEY,
  subject_name TEXT NOT NULL,
  pdf_url TEXT NOT NULL UNIQUE,
  file_path TEXT,
  downloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Attachments/worksheets from assessment detail pages
CREATE TABLE schoolbox_attachments (
  id SERIAL PRIMARY KEY,
  due_work_id INTEGER REFERENCES schoolbox_due_work(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  size TEXT,
  url TEXT NOT NULL UNIQUE,
  file_path TEXT,
  downloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attachments_due_work ON schoolbox_attachments(due_work_id);
