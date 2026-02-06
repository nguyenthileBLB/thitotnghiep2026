import * as mammoth from 'mammoth';
import { Question, QuestionType } from '../types';

const CORRECT_MARKER = ':::CORRECT:::';

/**
 * Đọc file .docx và trả về text đã được đánh dấu đáp án đúng dựa trên gạch chân
 */
export const readDocxFile = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        
        // Fix: Xử lý import mammoth an toàn cho môi trường browser/ESM
        // Một số bundler export default, một số export named functions
        const mammothLib = (mammoth as any).default || mammoth;

        if (!mammothLib || !mammothLib.convertToHtml) {
            throw new Error("Không thể tải thư viện đọc Word (Mammoth). Vui lòng tải lại trang.");
        }

        // Sử dụng convertToHtml để giữ lại thẻ <u> (gạch chân)
        // styleMap: ánh xạ style underline sang thẻ u
        const options = {
            styleMap: [
                "u => u"
            ]
        };
        
        const result = await mammothLib.convertToHtml({ arrayBuffer: arrayBuffer }, options);
        let html = result.value;

        // 1. Đánh dấu nội dung được gạch chân bằng marker đặc biệt
        // Regex bắt nội dung trong thẻ <u> </u>
        html = html.replace(/<u>(.*?)<\/u>/gi, `${CORRECT_MARKER}$1`);

        // 2. Chuyển đổi các thẻ block HTML thành xuống dòng để giữ cấu trúc
        html = html.replace(/<\/(p|div|h[1-6]|li)>/gi, '\n');
        html = html.replace(/<br\s*\/?>/gi, '\n');

        // 3. Xóa toàn bộ các thẻ HTML còn lại
        let text = html.replace(/<[^>]+>/g, '');

        // 4. Giải mã các ký tự HTML entities cơ bản
        text = text.replace(/&nbsp;/g, ' ')
                   .replace(/&lt;/g, '<')
                   .replace(/&gt;/g, '>')
                   .replace(/&amp;/g, '&');

        resolve(text); 
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Phân tích text thô thành danh sách câu hỏi
 * Dựa trên từ khóa: "PHẦN I", "PHẦN II", "PHẦN III", "Câu 1", "A.", "B.", "a)", "b)"...
 */
export const parseQuestionsFromText = (text: string): Question[] => {
  const questions: Question[] = [];
  
  // Chuẩn hóa text: xóa khoảng trắng thừa, đưa về dòng mới chuẩn
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\n\s+\n/g, '\n\n');

  // Tách các phần
  // Regex tìm PHẦN I, II, III (không phân biệt hoa thường)
  const partRegex = /PHẦN\s+(I|II|III|1|2|3)(?:\s*:|\s*\.\s*|\s*\n)/gi;
  
  // Tìm vị trí các phần
  const matches = [...normalizedText.matchAll(partRegex)];
  
  if (matches.length === 0) {
    throw new Error("Không tìm thấy tiêu đề 'PHẦN I', 'PHẦN II', 'PHẦN III' trong file.");
  }

  // Helper để lấy nội dung giữa các phần
  const getPartContent = (index: number) => {
    const start = matches[index].index! + matches[index][0].length;
    const end = matches[index + 1] ? matches[index + 1].index : normalizedText.length;
    return normalizedText.slice(start, end);
  };

  // Process từng phần tìm thấy
  matches.forEach((match, index) => {
    const partTypeStr = match[1].toUpperCase();
    const content = getPartContent(index);

    if (partTypeStr === 'I' || partTypeStr === '1') {
      questions.push(...parsePartI(content));
    } else if (partTypeStr === 'II' || partTypeStr === '2') {
      questions.push(...parsePartII(content));
    } else if (partTypeStr === 'III' || partTypeStr === '3') {
      questions.push(...parsePartIII(content));
    }
  });

  return questions;
};

// --- Parsers chi tiết từng phần ---

// Regex tìm câu hỏi: "Câu 1:", "Câu 1.", "Câu 1 "
const questionSplitRegex = /(?:^|\n)(?:Câu|Cau)\s+(\d+)(?:[:.]|\s)\s*/gi;

function parsePartI(text: string): Question[] {
  const result: Question[] = [];
  const parts = text.split(questionSplitRegex);
  // parts[0] là text trước câu 1 (bỏ qua), sau đó cứ cặp (số câu, nội dung)

  for (let i = 1; i < parts.length; i += 2) {
    // const qNum = parts[i]; 
    const qContent = parts[i+1];
    
    // Tách nội dung câu hỏi và các đáp án A, B, C, D
    // Cập nhật Regex: Chấp nhận marker :::CORRECT::: nằm trước hoặc chen giữa khoảng trắng
    const optionRegex = /(?:^|\s)(?:\s*:::CORRECT:::)?\s*([A-D])(?:[:.)])\s+/g;
    
    // Tìm các vị trí của options
    const optMatches = [...qContent.matchAll(optionRegex)];
    
    let questionText = qContent.trim();
    const options: string[] = ["", "", "", ""];
    let detectedCorrectOption = 0; // Mặc định A nếu không tìm thấy gạch chân
    
    if (optMatches.length >= 4) {
      // Lấy text câu hỏi (từ đầu đến option A)
      questionText = qContent.slice(0, optMatches[0].index).trim();
      // Xóa marker trong câu hỏi nếu lỡ dính
      questionText = questionText.split(CORRECT_MARKER).join('');
      
      // Lấy nội dung các option
      for (let j = 0; j < optMatches.length; j++) {
        const start = optMatches[j].index! + optMatches[j][0].length;
        const end = optMatches[j+1] ? optMatches[j+1].index : qContent.length;
        const fullMatch = optMatches[j][0];
        const optLabel = optMatches[j][1]; // A, B, C, or D
        
        let optIndex = -1;
        if (optLabel === 'A') optIndex = 0;
        if (optLabel === 'B') optIndex = 1;
        if (optLabel === 'C') optIndex = 2;
        if (optLabel === 'D') optIndex = 3;
        
        if (optIndex !== -1) {
             let rawOpt = qContent.slice(start, end).trim();
             
             // Kiểm tra marker ở label (gạch chân chữ A.) HOẶC ở nội dung
             const isMarkedInLabel = fullMatch.includes(CORRECT_MARKER);
             const isMarkedInContent = rawOpt.includes(CORRECT_MARKER);

             if (isMarkedInLabel || isMarkedInContent) {
                 detectedCorrectOption = optIndex;
                 rawOpt = rawOpt.split(CORRECT_MARKER).join('');
             }
             options[optIndex] = rawOpt.trim();
        }
      }
    }

    result.push({
      id: 0,
      type: QuestionType.MCQ,
      text: questionText,
      options: options,
      correctOption: detectedCorrectOption
    });
  }
  return result;
}

function parsePartII(text: string): Question[] {
  const result: Question[] = [];
  const parts = text.split(questionSplitRegex);

  for (let i = 1; i < parts.length; i += 2) {
    const qContent = parts[i+1];
    
    // Tìm các ý a), b), c), d)
    const stmtRegex = /(?:^|\s)(?:\s*:::CORRECT:::)?\s*([a-d])(?:[:.)])\s+/g;
    const stmtMatches = [...qContent.matchAll(stmtRegex)];
    
    let questionText = qContent.trim();
    const statements: string[] = ["", "", "", ""];
    const detectedCorrectTF: boolean[] = [false, false, false, false];

    if (stmtMatches.length >= 4) {
        questionText = qContent.slice(0, stmtMatches[0].index).trim();
        questionText = questionText.split(CORRECT_MARKER).join('');

        for (let j = 0; j < stmtMatches.length; j++) {
            const start = stmtMatches[j].index! + stmtMatches[j][0].length;
            const end = stmtMatches[j+1] ? stmtMatches[j+1].index : qContent.length;
            const fullMatch = stmtMatches[j][0];
            const label = stmtMatches[j][1].toLowerCase();
            
            let idx = -1;
            if (label === 'a') idx = 0;
            if (label === 'b') idx = 1;
            if (label === 'c') idx = 2;
            if (label === 'd') idx = 3;

            if (idx !== -1) {
                let rawStmt = qContent.slice(start, end).trim();
                
                const isMarkedInLabel = fullMatch.includes(CORRECT_MARKER);
                const isMarkedInContent = rawStmt.includes(CORRECT_MARKER);

                if (isMarkedInLabel || isMarkedInContent) {
                    detectedCorrectTF[idx] = true;
                    rawStmt = rawStmt.split(CORRECT_MARKER).join('');
                } else {
                    detectedCorrectTF[idx] = false;
                }
                statements[idx] = rawStmt.trim();
            }
        }
    }

    result.push({
      id: 0,
      type: QuestionType.TRUE_FALSE,
      text: questionText,
      statements: statements,
      correctTF: detectedCorrectTF
    });
  }
  return result;
}

function parsePartIII(text: string): Question[] {
  const result: Question[] = [];
  const parts = text.split(questionSplitRegex);

  for (let i = 1; i < parts.length; i += 2) {
    const qContent = parts[i+1];
    // Với phần 3, lấy toàn bộ text làm câu hỏi, bỏ qua các từ khóa "Đáp án:" nếu có để sạch
    // Xóa marker nếu có
    let cleanText = qContent.replace(/(Đáp án|Lời giải)[:].*/gis, "").split(CORRECT_MARKER).join('').trim();

    result.push({
      id: 0,
      type: QuestionType.SHORT_ANSWER,
      text: cleanText,
      correctShort: 0 // GV tự điền, phần này khó auto-detect chính xác số từ text
    });
  }
  return result;
}