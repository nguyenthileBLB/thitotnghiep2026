export enum ExamStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  ACTIVE = 'ACTIVE',
  FINISHED = 'FINISHED'
}

export enum QuestionType {
  MCQ = 'MCQ',           // Phần I: Trắc nghiệm 4 lựa chọn
  TRUE_FALSE = 'TRUE_FALSE', // Phần II: Đúng/Sai
  SHORT_ANSWER = 'SHORT_ANSWER' // Phần III: Trả lời ngắn
}

export interface Question {
  id: number;
  type: QuestionType;
  text: string;
  // Dành cho Phần I
  options?: string[]; 
  correctOption?: number; 
  // Dành cho Phần II
  statements?: string[]; // 4 ý a, b, c, d
  correctTF?: boolean[]; // [true, false, true, false]
  // Dành cho Phần III
  correctShort?: number; // Đáp án là số
}

export interface QuestionPack {
  id: string;
  title: string;
  questions: Question[];
  createdAt: number;
}

export interface Student {
  id: string;
  name: string;
  // answers lưu trữ:
  // MCQ: number (index)
  // TRUE_FALSE: boolean[] ([true, false, null, true])
  // SHORT_ANSWER: number (giá trị học sinh nhập)
  answers: Record<number, any>; 
  score: number;
  finished: boolean;
  violationCount: number; // Số lần rời màn hình
}

export interface ExamData {
  examId?: string; // Định danh phiên thi (VD: packId_timestamp)
  title: string;
  questions: Question[]; // Đây là câu hỏi của đề ĐANG THI (Active)
  packs: QuestionPack[]; // Danh sách tất cả các đề đã tải lên
  status: ExamStatus;
  students: Student[];
  startTime?: number; // Thời điểm bắt đầu (timestamp)
  duration?: number;  // Thời gian làm bài (phút)
}

export type BroadcastAction = 
  | { type: 'SYNC_STATE'; payload: Partial<ExamData> }
  | { type: 'REQUEST_STATE' } // Action mới: Học sinh yêu cầu lấy dữ liệu
  | { type: 'STUDENT_JOIN'; payload: { id: string; name: string } }
  | { type: 'STUDENT_ANSWER'; payload: { studentId: string; questionId: number; answer: any } }
  | { type: 'STUDENT_VIOLATION'; payload: { studentId: string } }
  | { type: 'STUDENT_FINISH'; payload: { studentId: string } }
  | { type: 'RESET' };