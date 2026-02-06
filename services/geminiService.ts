// Dịch vụ AI đã được gỡ bỏ theo yêu cầu.
// File này được giữ lại để tránh lỗi import nếu có, nhưng không còn chức năng.
import { Question } from '../types';

export const parseExamFromText = async (text: string): Promise<Question[]> => {
  return [];
};

export const parseExamFromImage = async (base64Image: string): Promise<Question[]> => {
  return [];
};
