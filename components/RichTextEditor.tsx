import React, { useEffect, useRef } from 'react';
import Quill from 'quill';

interface RichTextEditorProps {
  value: string;
  onChange: (content: string) => void;
  placeholder?: string;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange, placeholder }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);

  useEffect(() => {
    if (editorRef.current && !quillRef.current) {
      // Fix: Xử lý import Quill an toàn (default export vs named export)
      const QuillClass = (Quill as any).default || Quill;
      
      if (!QuillClass) {
          console.error("Quill library not loaded");
          return;
      }

      const quill = new QuillClass(editorRef.current, {
        theme: 'snow',
        placeholder: placeholder || 'Nhập nội dung...',
        modules: {
          toolbar: [
            ['bold', 'italic', 'underline'],
            [{ 'script': 'sub'}, { 'script': 'super' }], // Chỉ số dưới, chỉ số trên
            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
            ['image'], // Nút chèn ảnh
            ['clean'] // Xóa định dạng
          ]
        }
      });

      quill.on('text-change', () => {
        // Lấy HTML content
        const html = quill.root.innerHTML;
        // Nếu chỉ có thẻ p trống thì coi như rỗng
        if (html === '<p><br></p>') {
            onChange('');
        } else {
            onChange(html);
        }
      });

      quillRef.current = quill;
    }
  }, []);

  // Sync value prop changes to editor (one-way sync mostly for reset)
  useEffect(() => {
    if (quillRef.current) {
      const currentContent = quillRef.current.root.innerHTML;
      if (value !== currentContent && value === '') {
         quillRef.current.root.innerHTML = '';
      } else if (value !== currentContent && !quillRef.current.hasFocus()) {
          // Chỉ update nếu editor không có focus để tránh nhảy con trỏ
          quillRef.current.root.innerHTML = value;
      }
    }
  }, [value]);

  return (
    <div className="bg-white rounded-lg">
      <div ref={editorRef} style={{ height: '150px', borderBottomLeftRadius: '0.5rem', borderBottomRightRadius: '0.5rem' }} />
    </div>
  );
};