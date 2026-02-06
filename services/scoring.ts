import { Question, QuestionType } from '../types';

/**
 * Tính điểm bài làm của học sinh theo thang điểm 10 chuẩn Hóa học 2025
 */
export const calculateScore = (questions: Question[], answers: Record<number, any>): number => {
  let totalScore = 0;

  questions.forEach(q => {
    const studentAns = answers[q.id];
    
    // Nếu chưa làm thì bỏ qua
    if (studentAns === undefined || studentAns === null || studentAns === '') return;

    // PHẦN I: Trắc nghiệm (0.25đ/câu)
    if (q.type === QuestionType.MCQ) {
      if (studentAns === q.correctOption) {
        totalScore += 0.25;
      }
    } 
    // PHẦN II: Đúng/Sai (Tối đa 1.0đ/câu)
    // - 1 ý đúng: 0.1đ
    // - 2 ý đúng: 0.25đ
    // - 3 ý đúng: 0.5đ
    // - 4 ý đúng: 1.0đ
    else if (q.type === QuestionType.TRUE_FALSE) {
      if (Array.isArray(studentAns) && Array.isArray(q.correctTF)) {
        let correctCount = 0;
        // Đếm số ý trả lời đúng
        q.correctTF.forEach((tf, idx) => {
          if (studentAns[idx] === tf) correctCount++;
        });

        if (correctCount === 1) totalScore += 0.1;
        else if (correctCount === 2) totalScore += 0.25;
        else if (correctCount === 3) totalScore += 0.5;
        else if (correctCount === 4) totalScore += 1.0;
      }
    } 
    // PHẦN III: Trả lời ngắn (0.25đ/câu)
    else if (q.type === QuestionType.SHORT_ANSWER) {
      // Xử lý dấu phẩy thành dấu chấm và parse số
      let val = parseFloat(studentAns.toString().replace(',', '.'));
      const correct = q.correctShort || 0;
      
      // Chấp nhận sai số nhỏ (0.05) để tránh lỗi làm tròn
      if (!isNaN(val) && Math.abs(val - correct) < 0.05) {
        totalScore += 0.25;
      }
    }
  });

  // Làm tròn 2 chữ số thập phân để tránh lỗi floating point (VD: 9.99999)
  return Math.round(totalScore * 100) / 100;
};

/**
 * Phân tích cấu trúc đề thi để xem có chuẩn form 2025 không
 * Chuẩn: 18 câu MCQ, 4 câu TF, 6 câu Short -> Tổng 10đ
 */
export const analyzeExamStructure = (questions: Question[]) => {
  const mcqCount = questions.filter(q => q.type === QuestionType.MCQ).length;
  const tfCount = questions.filter(q => q.type === QuestionType.TRUE_FALSE).length;
  const shortCount = questions.filter(q => q.type === QuestionType.SHORT_ANSWER).length;
  
  // Tính tổng điểm tối đa dựa trên số lượng câu hỏi hiện có
  const maxScore = (mcqCount * 0.25) + (tfCount * 1.0) + (shortCount * 0.25);
  
  // Kiểm tra xem có đúng chuẩn Form 2025 không
  const isStandard = mcqCount === 18 && tfCount === 4 && shortCount === 6;

  return {
    mcqCount,
    tfCount,
    shortCount,
    maxScore: Math.round(maxScore * 100) / 100,
    isStandard
  };
};