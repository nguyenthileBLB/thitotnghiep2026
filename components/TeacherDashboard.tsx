import React, { useState, useRef, useEffect } from 'react';
import { ExamData, Question, ExamStatus, QuestionType, QuestionPack } from '../types';
import { Button } from './ui/Button';
import { sendAction } from '../services/syncService';
import { readDocxFile, parseQuestionsFromText } from '../services/wordParser';
import { RichTextEditor } from './RichTextEditor';
import { analyzeExamStructure } from '../services/scoring';
import { StudentView } from './StudentView'; // Import StudentView để dùng cho Preview

interface TeacherDashboardProps {
  examData: ExamData;
  setExamData: React.Dispatch<React.SetStateAction<ExamData>>;
  onBack: () => void;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({ examData, setExamData, onBack }) => {
  const [showModal, setShowModal] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [activeTab, setActiveTab] = useState<QuestionType>(QuestionType.MCQ);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null); 
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [timeLeft, setTimeLeft] = useState<string>("--:--");
  
  // State quản lý pack đang xem/sửa (Local state của GV)
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);

  // PREVIEW MODE
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  // Form nhập liệu
  const [qText, setQText] = useState('');
  const [options, setOptions] = useState<string[]>(['', '', '', '']);
  const [correctOption, setCorrectOption] = useState(0);
  const [statements, setStatements] = useState<string[]>(['', '', '', '']);
  const [correctTF, setCorrectTF] = useState<boolean[]>([false, false, false, false]);
  const [correctShort, setCorrectShort] = useState<number>(0);

  // Timer logic
  useEffect(() => {
    let interval: any;
    if (examData.status === ExamStatus.ACTIVE && examData.startTime && examData.duration) {
        interval = setInterval(() => {
            const now = Date.now();
            const endTime = examData.startTime! + (examData.duration! * 60 * 1000);
            const diff = endTime - now;

            if (diff <= 0) {
                setTimeLeft("00:00");
                // Tự động kết thúc nếu cần, nhưng thường GV sẽ ấn nút.
                // Hoặc chỉ hiện 00:00 để GV biết.
            } else {
                const minutes = Math.floor(diff / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                setTimeLeft(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
            }
        }, 1000);
    } else {
        setTimeLeft("--:--");
    }
    return () => clearInterval(interval);
  }, [examData.status, examData.startTime, examData.duration]);

  // Tự động chọn pack mới nhất nếu chưa chọn
  useEffect(() => {
    if (!selectedPackId && examData.packs && examData.packs.length > 0) {
      setSelectedPackId(examData.packs[0].id);
    }
  }, [examData.packs]);

  const currentPack = examData.packs?.find(p => p.id === selectedPackId) || null;
  const structure = analyzeExamStructure(currentPack?.questions || []);

  // Cập nhật câu hỏi cho pack đang chọn
  const updateCurrentPackQuestions = (newQuestions: Question[]) => {
    if (!selectedPackId) return;

    // Đánh lại số thứ tự
    const indexedQuestions = newQuestions.map((q, idx) => ({ ...q, id: idx + 1 }));

    const updatedPacks = examData.packs.map(p => {
        if (p.id === selectedPackId) {
            return { ...p, questions: indexedQuestions };
        }
        return p;
    });

    const newData = { packs: updatedPacks };
    setExamData(prev => ({ ...prev, ...newData }));
    sendAction({ type: 'SYNC_STATE', payload: newData });
  };

  const handleWordUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
        const text = await readDocxFile(file);
        const questions = parseQuestionsFromText(text);
        if (questions.length === 0) {
            alert("Không tìm thấy câu hỏi nào. Vui lòng kiểm tra định dạng file.");
        } else {
            // TẠO GÓI ĐỀ THI MỚI
            const newPackId = Date.now().toString();
            const indexedQuestions = questions.map((q, idx) => ({ ...q, id: idx + 1 }));
            
            const newPack: QuestionPack = {
                id: newPackId,
                title: file.name.replace('.docx', ''),
                questions: indexedQuestions,
                createdAt: Date.now()
            };

            const updatedPacks = [...(examData.packs || []), newPack];
            
            // Cập nhật state
            const newData = { packs: updatedPacks };
            setExamData(prev => ({ ...prev, ...newData }));
            sendAction({ type: 'SYNC_STATE', payload: newData });
            
            // Chuyển view sang đề vừa tạo
            setSelectedPackId(newPackId);
            alert(`Đã tạo đề thi mới: "${newPack.title}" với ${questions.length} câu hỏi.`);
        }
    } catch (error) {
        console.error(error);
        alert("Lỗi đọc file: " + (error as any).message);
    } finally {
        setIsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const createEmptyPack = () => {
    const newPackId = Date.now().toString();
    const newPack: QuestionPack = {
        id: newPackId,
        title: `Đề thi mới ${examData.packs.length + 1}`,
        questions: [],
        createdAt: Date.now()
    };
    const updatedPacks = [...(examData.packs || []), newPack];
    setExamData(prev => ({ ...prev, packs: updatedPacks }));
    sendAction({ type: 'SYNC_STATE', payload: { packs: updatedPacks } });
    setSelectedPackId(newPackId);
  };

  const deletePack = (packId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Bạn có chắc muốn xóa đề thi này không?")) {
        const updatedPacks = examData.packs.filter(p => p.id !== packId);
        setExamData(prev => ({ ...prev, packs: updatedPacks }));
        sendAction({ type: 'SYNC_STATE', payload: { packs: updatedPacks } });
        if (selectedPackId === packId) setSelectedPackId(null);
    }
  };

  // --- QUESTION EDITOR LOGIC ---
  const resetForm = () => {
    setQText('');
    setOptions(['', '', '', '']);
    setCorrectOption(0);
    setStatements(['', '', '', '']);
    setCorrectTF([false, false, false, false]);
    setCorrectShort(0);
    setEditingIndex(null);
  };

  const openAddModal = () => {
      if (!selectedPackId) {
          alert("Vui lòng chọn hoặc tạo một đề thi trước.");
          return;
      }
      resetForm();
      setShowModal(true);
  };

  const handleEditQuestion = (index: number) => {
    if (!currentPack) return;
    const q = currentPack.questions[index];
    
    setActiveTab(q.type);
    setQText(q.text);

    if (q.type === QuestionType.MCQ) {
        setOptions(q.options ? [...q.options] : ['', '', '', '']);
        setCorrectOption(q.correctOption || 0);
    } else if (q.type === QuestionType.TRUE_FALSE) {
        setStatements(q.statements ? [...q.statements] : ['', '', '', '']);
        setCorrectTF(q.correctTF ? [...q.correctTF] : [false, false, false, false]);
    } else if (q.type === QuestionType.SHORT_ANSWER) {
        setCorrectShort(q.correctShort || 0);
    }

    setEditingIndex(index);
    setShowModal(true);
  };

  const handleSaveQuestion = () => {
    if (!selectedPackId || !currentPack) return;

    const plainText = qText.replace(/<[^>]+>/g, '').trim();
    const hasImage = qText.includes('<img');

    if (!plainText && !hasImage) {
      alert("Vui lòng nhập nội dung câu hỏi");
      return;
    }

    const newQ: Question = {
      id: 0, 
      type: activeTab,
      text: qText,
    };

    if (activeTab === QuestionType.MCQ) {
      newQ.options = [...options];
      newQ.correctOption = correctOption;
    } else if (activeTab === QuestionType.TRUE_FALSE) {
      newQ.statements = [...statements];
      newQ.correctTF = [...correctTF];
    } else if (activeTab === QuestionType.SHORT_ANSWER) {
      newQ.correctShort = correctShort;
    }

    let newQuestions = [...currentPack.questions];
    if (editingIndex !== null) {
        newQuestions[editingIndex] = newQ;
    } else {
        newQuestions.push(newQ);
    }

    updateCurrentPackQuestions(newQuestions);
    resetForm();
    setShowModal(false);
  };

  const handleDeleteQuestion = (index: number) => {
    if (!currentPack) return;
    if (confirm("Xóa câu hỏi này?")) {
        const newQuestions = [...currentPack.questions];
        newQuestions.splice(index, 1);
        updateCurrentPackQuestions(newQuestions);
    }
  };

  // --- EXAM CONTROL LOGIC ---
  const startExam = () => {
    if (!currentPack || currentPack.questions.length === 0) {
        alert("Đề thi này chưa có câu hỏi!");
        return;
    }
    
    const newExamId = `${currentPack.id}_${Date.now()}`;

    const resetStudents = examData.students.map(s => ({
        ...s,
        answers: {},
        score: 0,
        finished: false,
        violationCount: 0
    }));

    const newData = { 
        questions: currentPack.questions,
        title: currentPack.title,
        status: ExamStatus.ACTIVE,
        examId: newExamId, 
        students: resetStudents,
        startTime: Date.now(),
        duration: 50 // Thời gian làm bài mặc định 50p
    };
    
    setExamData(prev => ({ ...prev, ...newData }));
    sendAction({ type: 'SYNC_STATE', payload: newData });
  };

  // Nút thủ công giúp GV gửi lại state cho toàn bộ HS nếu có sự cố
  const resyncExam = () => {
      // Chỉ gửi thông tin cần thiết, không gửi packs
      const syncPayload = {
          examId: examData.examId,
          title: examData.title,
          questions: examData.questions,
          status: examData.status,
          startTime: examData.startTime,
          duration: examData.duration
      };
      sendAction({ type: 'SYNC_STATE', payload: syncPayload });
      alert("Đã phát lại tín hiệu đề thi cho tất cả học sinh!");
  };

  const finishExam = () => {
    const newData = { status: ExamStatus.FINISHED };
    setExamData(prev => ({ ...prev, ...newData }));
    sendAction({ type: 'SYNC_STATE', payload: newData });
  };

  const resetExam = () => {
    const newData: Partial<ExamData> = {
      questions: [],
      status: ExamStatus.IDLE,
      students: [],
      examId: '',
      startTime: undefined
    };
    setExamData(prev => ({ ...prev, ...newData }));
    sendAction({ type: 'SYNC_STATE', payload: newData });
  };

  // --- RENDER ---
  // Nếu đang ở chế độ xem trước, render component StudentView đè lên
  if (isPreviewMode) {
     // Tạo dữ liệu giả lập cho xem trước: Sử dụng câu hỏi của pack đang chọn
     const previewData: ExamData = {
         ...examData,
         // Nếu chưa bắt đầu thi, dùng câu hỏi của pack đang chọn để preview
         questions: currentPack ? currentPack.questions : [],
         status: ExamStatus.ACTIVE, // Force active để hiện câu hỏi
         startTime: Date.now(),
         duration: 50
     };

     return (
         <div className="fixed inset-0 z-50 bg-white">
             <StudentView 
                examData={previewData} 
                onBack={() => setIsPreviewMode(false)} 
                previewMode={true} 
             />
         </div>
     );
  }

  const maxScore = 10;
  const stats = examData.students.map(s => ({ name: s.name, score: s.score, finished: s.finished }));

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      
      {/* SIDEBAR: Danh sách đề thi */}
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col shadow-sm z-20">
        <div className="p-4 border-b border-slate-100 flex items-center gap-2">
            <button 
                onClick={onBack} 
                className="flex items-center gap-1 bg-red-50 hover:bg-red-100 px-2 py-1 rounded text-xs text-red-600 transition-colors font-medium border border-red-100"
                title="Quay lại chọn vai trò"
            >
                ⬅️ Thoát
            </button>
            <div className="ml-1">
                <h2 className="font-bold text-slate-800 leading-tight">Kho Đề Thi</h2>
            </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {examData.packs?.map(pack => (
                <div 
                    key={pack.id}
                    onClick={() => setSelectedPackId(pack.id)}
                    className={`p-3 rounded-lg cursor-pointer border transition-all group relative
                        ${selectedPackId === pack.id 
                            ? 'bg-indigo-50 border-primary shadow-sm' 
                            : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-200'}`}
                >
                    <h3 className={`font-medium text-sm truncate pr-6 ${selectedPackId === pack.id ? 'text-primary' : 'text-slate-700'}`}>
                        {pack.title}
                    </h3>
                    <div className="flex justify-between items-center mt-1">
                        <span className="text-xs text-slate-400">{pack.questions.length} câu</span>
                        <span className="text-[10px] text-slate-300">
                            {new Date(pack.createdAt).toLocaleDateString('vi-VN')}
                        </span>
                    </div>
                    {/* Delete button (only show on hover) */}
                    <button 
                        onClick={(e) => deletePack(pack.id, e)}
                        className="absolute top-2 right-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Xóa đề thi"
                    >
                        ✕
                    </button>
                </div>
            ))}
            {(!examData.packs || examData.packs.length === 0) && (
                <div className="text-center py-8 text-xs text-slate-400 px-4">
                    Chưa có đề thi nào. Hãy tải file hoặc tạo mới.
                </div>
            )}
        </div>

        <div className="p-3 border-t border-slate-100 bg-slate-50 space-y-2">
             <input 
                  type="file" 
                  accept=".docx" 
                  ref={fileInputRef} 
                  className="hidden" 
                  onChange={handleWordUpload}
              />
            <Button fullWidth onClick={() => fileInputRef.current?.click()} disabled={isProcessing} className="text-xs">
                 {isProcessing ? 'Đang tải...' : '📂 Tải file Word'}
            </Button>
            <Button fullWidth variant="outline" onClick={createEmptyPack} className="text-xs">
                 ➕ Tạo đề trống
            </Button>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        
        {/* Header Actions */}
        <header className="bg-white px-6 py-4 border-b border-slate-200 flex justify-between items-center shadow-sm z-10">
            <div>
                 <h1 className="text-xl font-bold text-slate-800">
                    {currentPack ? currentPack.title : "Chọn đề thi"}
                 </h1>
                 <div className="flex flex-col gap-1 text-sm text-slate-500 mt-1">
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                            <span>Trạng thái:</span>
                            <span className={`font-bold px-2 py-0.5 rounded text-xs ${
                                examData.status === ExamStatus.ACTIVE ? 'bg-green-100 text-green-700' : 
                                examData.status === ExamStatus.FINISHED ? 'bg-red-100 text-red-700' : 'bg-slate-100'
                            }`}>
                                {examData.status === ExamStatus.IDLE ? 'SẴN SÀNG' : 
                                examData.status === ExamStatus.ACTIVE ? 'ĐANG THI' : 'ĐÃ KẾT THÚC'}
                            </span>
                        </div>
                        {examData.status === ExamStatus.ACTIVE && (
                            <div className="flex items-center gap-1 bg-yellow-50 px-2 py-0.5 rounded border border-yellow-200">
                                <span>⏱️</span>
                                <span className="font-mono font-bold text-yellow-700">{timeLeft}</span>
                            </div>
                        )}
                    </div>
                    
                    {/* Structure Analysis */}
                    {currentPack && (
                        <div className={`flex items-center gap-2 text-xs border rounded px-2 py-1 ${structure.isStandard ? 'bg-green-50 border-green-200 text-green-800' : 'bg-orange-50 border-orange-200 text-orange-800'}`}>
                             <span className="font-bold">{structure.isStandard ? '✅ Chuẩn Form 2025:' : '⚠️ Chưa chuẩn Form:'}</span>
                             <span>I: {structure.mcqCount}/18</span>
                             <span>|</span>
                             <span>II: {structure.tfCount}/4</span>
                             <span>|</span>
                             <span>III: {structure.shortCount}/6</span>
                             <span>|</span>
                             <span className="font-bold">Max: {structure.maxScore}đ</span>
                        </div>
                    )}
                 </div>
            </div>

            <div className="flex gap-2">
                 {examData.status === ExamStatus.ACTIVE && (
                     <Button variant="outline" onClick={resyncExam} title="Gửi lại đề cho tất cả HS nếu có lỗi mạng">
                         📡 Phát lại đề
                     </Button>
                 )}

                 {(examData.status === ExamStatus.IDLE || examData.status === ExamStatus.READY) && currentPack && (
                     <>
                        <Button variant="outline" onClick={() => setIsPreviewMode(true)}>
                            👁️ Xem trước (HS)
                        </Button>
                        <Button variant="outline" onClick={openAddModal}>➕ Thêm câu hỏi</Button>
                        <Button onClick={startExam} variant="secondary">▶️ Bắt đầu thi (50p)</Button>
                     </>
                 )}
                 {examData.status === ExamStatus.ACTIVE && (
                    <Button onClick={finishExam} variant="danger">⏹ Kết thúc</Button>
                 )}
                 {examData.status === ExamStatus.FINISHED && (
                    <Button onClick={resetExam} variant="outline">🔄 Làm mới</Button>
                 )}
                 <button 
                    onClick={() => setShowHelp(true)}
                    className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center font-bold"
                 >?</button>
            </div>
        </header>

        {/* Workspace: Preview & Stats */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row p-4 gap-4">
            
            {/* Left: Questions Preview */}
            <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <span className="font-semibold text-slate-700 text-sm">Nội dung đề thi ({currentPack?.questions.length || 0})</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
                    {currentPack ? currentPack.questions.map((q, idx) => (
                        <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200 relative group">
                             {/* Edit Controls */}
                            {(examData.status === ExamStatus.IDLE || examData.status === ExamStatus.READY) && (
                                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-all z-10 flex gap-1 bg-white/80 p-1 rounded backdrop-blur-sm shadow-sm">
                                    <button onClick={() => handleEditQuestion(idx)} className="text-blue-500 hover:bg-blue-50 p-1.5 rounded" title="Sửa">✏️</button>
                                    <button onClick={() => handleDeleteQuestion(idx)} className="text-red-500 hover:bg-red-50 p-1.5 rounded" title="Xóa">🗑️</button>
                                </div>
                            )}
                            
                            <div className="text-sm text-slate-800 mb-2 prose prose-sm max-w-none">
                                <span className="text-primary font-bold mr-1">Câu {idx + 1}:</span>
                                <div className="inline" dangerouslySetInnerHTML={{ __html: q.text }} />
                            </div>

                            {/* Preview Types */}
                            {q.type === QuestionType.MCQ && (
                                <div className="grid grid-cols-2 gap-1 text-xs">
                                    {q.options?.map((opt, i) => (
                                        <div key={i} className={`p-1 rounded border truncate ${q.correctOption === i ? 'bg-green-50 border-green-200 text-green-700 font-bold' : 'bg-white text-slate-500'}`}>
                                            {String.fromCharCode(65+i)}. {opt}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {q.type === QuestionType.TRUE_FALSE && (
                                <div className="space-y-1 text-xs">
                                    {q.statements?.map((stmt, i) => (
                                        <div key={i} className="flex justify-between items-center bg-white p-1 rounded border border-slate-100">
                                            <span className="truncate flex-1 mr-2">{String.fromCharCode(97+i)}. {stmt}</span>
                                            <span className={q.correctTF?.[i] ? 'text-green-600 font-bold' : 'text-red-500'}>{q.correctTF?.[i] ? 'Đ' : 'S'}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {q.type === QuestionType.SHORT_ANSWER && (
                                <div className="text-xs font-bold text-blue-600">Đáp án: {q.correctShort}</div>
                            )}
                        </div>
                    )) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <p>Chọn một đề thi từ danh sách bên trái</p>
                            <p className="text-xs">hoặc tải file mới</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Right: Live Monitoring */}
            <div className="w-full md:w-96 flex flex-col gap-4">
                 {/* Chart */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 h-64 flex flex-col">
                    <h3 className="font-semibold text-slate-700 text-sm mb-4">Kết quả trực tiếp</h3>
                    <div className="flex-1 border-b border-l border-slate-200 relative flex items-end justify-around px-2 pb-1 gap-2">
                        {stats.length > 0 ? stats.map((s, idx) => (
                             <div key={idx} className="flex flex-col items-center flex-1 group relative">
                                <div 
                                    className={`w-full max-w-[30px] rounded-t transition-all ${s.finished ? 'bg-green-500' : 'bg-primary'}`}
                                    style={{ height: `${Math.max(5, (s.score / maxScore) * 100)}%` }}
                                >
                                    <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-20">
                                        {s.score.toFixed(2)}
                                    </div>
                                </div>
                                <span className="text-[9px] text-slate-500 mt-1 truncate w-full text-center">{s.name}</span>
                             </div>
                        )) : (
                            <div className="absolute inset-0 flex items-center justify-center text-slate-300 text-xs">
                                Chưa có dữ liệu
                            </div>
                        )}
                    </div>
                    <div className="flex justify-center gap-4 mt-2 text-[10px] text-slate-500">
                         <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary"></span> Đang thi</div>
                         <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500"></span> Đã nộp</div>
                    </div>
                </div>

                {/* Student List */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex-1 flex flex-col overflow-hidden">
                    <h3 className="font-semibold text-slate-700 text-sm mb-2">Danh sách thí sinh ({examData.students.length})</h3>
                    <div className="flex-1 overflow-y-auto no-scrollbar">
                        <table className="w-full text-xs text-left">
                            <thead className="text-slate-500 uppercase bg-slate-50 sticky top-0">
                                <tr>
                                    <th className="px-2 py-2">Tên</th>
                                    <th className="px-2 py-2 text-center">Trạng thái</th>
                                    <th className="px-2 py-2 text-right">Điểm</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {examData.students.map(s => (
                                    <tr key={s.id} className={`hover:bg-slate-50 ${s.violationCount > 0 ? 'bg-red-50' : ''}`}>
                                        <td className="px-2 py-2 font-medium text-slate-900 truncate max-w-[100px]">{s.name}</td>
                                        <td className="px-2 py-2 text-center">
                                            {s.violationCount > 0 ? (
                                                <span className="text-red-600 font-bold bg-red-100 px-2 py-0.5 rounded-full text-[10px] mr-1">
                                                    {s.violationCount} ⚠️
                                                </span>
                                            ) : null}
                                            {s.finished && <span className="text-green-600 font-bold text-[10px]">Đã nộp</span>}
                                        </td>
                                        <td className="px-2 py-2 text-right font-bold text-primary">{s.score.toFixed(2)}</td>
                                    </tr>
                                ))}
                                {examData.students.length === 0 && (
                                    <tr><td colSpan={3} className="text-center py-4 text-slate-400">Trống</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
        
        {/* Modals giữ nguyên */}
        {showHelp && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-2xl">
                    <h3 className="text-lg font-bold mb-2">Hướng dẫn Upload</h3>
                    <p className="text-sm text-slate-600 mb-4">File Word cần có định dạng sau để hệ thống tự động nhận diện:</p>
                    <div className="bg-slate-100 p-3 rounded text-xs font-mono mb-4">
                        PHẦN I<br/>
                        Câu 1: Nội dung...<br/>
                        A. ... B. ...<br/><br/>
                        PHẦN II<br/>
                        Câu 1: ...<br/>
                        a) ... b) ...
                    </div>
                    <div className="flex justify-end"><Button onClick={() => setShowHelp(false)}>Đóng</Button></div>
                </div>
            </div>
        )}

        {showModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl flex flex-col max-h-[90vh]">
                    <div className="p-4 border-b flex justify-between items-center">
                        <h3 className="font-bold text-lg">{editingIndex !== null ? 'Sửa câu hỏi' : 'Thêm câu hỏi'}</h3>
                        <div className="flex bg-slate-100 rounded p-1">
                            {[QuestionType.MCQ, QuestionType.TRUE_FALSE, QuestionType.SHORT_ANSWER].map(t => (
                                <button 
                                    key={t}
                                    onClick={() => editingIndex === null && setActiveTab(t)}
                                    className={`px-3 py-1 text-xs rounded ${activeTab === t ? 'bg-white shadow text-primary font-bold' : 'text-slate-500'} ${editingIndex !== null ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    {t === QuestionType.MCQ ? 'Phần I' : t === QuestionType.TRUE_FALSE ? 'Phần II' : 'Phần III'}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="p-4 overflow-y-auto flex-1 space-y-4">
                        <div>
                             <label className="text-xs font-bold text-slate-500 block mb-1">NỘI DUNG</label>
                             <RichTextEditor value={qText} onChange={setQText} placeholder="Nhập câu hỏi..." />
                        </div>
                        
                        {activeTab === QuestionType.MCQ && (
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 block">ĐÁP ÁN</label>
                                {options.map((opt, i) => (
                                    <div key={i} className="flex gap-2 items-center">
                                        <span className="font-bold text-slate-400 w-4">{String.fromCharCode(65+i)}</span>
                                        <input className="flex-1 border rounded p-2 text-sm" value={opt} onChange={e => {
                                            const newOpts = [...options]; newOpts[i] = e.target.value; setOptions(newOpts);
                                        }} placeholder={`Đáp án ${String.fromCharCode(65+i)}`} />
                                        <input type="radio" name="corr" checked={correctOption === i} onChange={() => setCorrectOption(i)} />
                                    </div>
                                ))}
                            </div>
                        )}

                        {activeTab === QuestionType.TRUE_FALSE && (
                             <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 block">PHÁT BIỂU</label>
                                {statements.map((stmt, i) => (
                                    <div key={i} className="flex gap-2 items-center">
                                        <span className="font-bold text-slate-400 w-4">{String.fromCharCode(97+i)}</span>
                                        <input className="flex-1 border rounded p-2 text-sm" value={stmt} onChange={e => {
                                            const newStmts = [...statements]; newStmts[i] = e.target.value; setStatements(newStmts);
                                        }} />
                                        <div className="flex bg-slate-100 rounded">
                                            <button className={`px-2 py-1 text-xs rounded ${correctTF[i] ? 'bg-green-500 text-white' : ''}`} onClick={() => {const n = [...correctTF]; n[i]=true; setCorrectTF(n)}}>Đ</button>
                                            <button className={`px-2 py-1 text-xs rounded ${!correctTF[i] ? 'bg-red-500 text-white' : ''}`} onClick={() => {const n = [...correctTF]; n[i]=false; setCorrectTF(n)}}>S</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {activeTab === QuestionType.SHORT_ANSWER && (
                             <div>
                                <label className="text-xs font-bold text-slate-500 block mb-1">ĐÁP ÁN SỐ</label>
                                <input type="number" step="0.01" className="border rounded p-2 w-full font-bold" value={correctShort} onChange={e => setCorrectShort(parseFloat(e.target.value))} />
                             </div>
                        )}
                    </div>
                    <div className="p-4 border-t bg-slate-50 flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setShowModal(false)}>Hủy</Button>
                        <Button onClick={handleSaveQuestion}>Lưu</Button>
                    </div>
                </div>
            </div>
        )}

      </div>
    </div>
  );
};