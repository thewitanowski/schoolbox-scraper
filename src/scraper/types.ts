export interface TimetablePeriod {
  dayName: string
  week: string
  periodLabel: string
  startTime: string
  endTime: string
  subjectCode: string
  room: string
}

export interface DueWorkItem {
  schoolboxUrl: string
  title: string
  subject: string
  subjectCode: string
  type: string
  dueDate: string
  status: string
  weighting: string
  description: string
  criteria: string
  materials: string
  terminology: string
  aiPolicy: string
  teacher: string
  attachments: AttachmentInfo[]
}

export interface AttachmentInfo {
  name: string
  size: string
  url: string
}

export interface GradeEntry {
  subject: string
  subjectCode: string
  teacher: string
  assessmentName: string
  status: string
  type: string
  dueDate: string
  grade: string
  feedback: string
}

export interface FeedItem {
  feedDate: string
  title: string
  teacher: string
  subject: string
  time: string
  grade: string
  feedback: string
  detailUrl: string
}

export interface ScheduleInfo {
  subjectName: string
  pdfUrl: string
  filePath: string | null
}

export interface ScrapeResult {
  timetable: TimetablePeriod[]
  subjects: Map<string, string> // code -> name
  dueWork: DueWorkItem[]
  grades: GradeEntry[]
  feed: FeedItem[]
  schedules: ScheduleInfo[]
}
