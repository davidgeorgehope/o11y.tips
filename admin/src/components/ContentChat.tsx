import { useState, useRef, useEffect } from 'react';
import { api, ComponentGenerationResult } from '../api/client';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  explanation?: string | null;
  diff?: string | null;
  updatedContent?: string | null;
}

interface ContentChatProps {
  contentId: string;
  currentContent: string;
  onApplyChanges: (newContent: string) => void;
  componentStatus?: ComponentGenerationResult[] | null;
}

const EXAMPLE_PROMPTS = [
  'Make the introduction shorter and more direct',
  'Remove any filler phrases and hedging language',
  'Add a concrete example to illustrate the main point',
  'Improve the technical accuracy of the explanation',
  'Make the conclusion more actionable',
];

const PREVIEW_PROMPTS = [
  'Why did the comparison-table component fail to generate?',
  'Are there any rendering issues in the preview?',
  'Check if the component placeholders are correctly formatted',
];

export default function ContentChat({ contentId, currentContent, onApplyChanges, componentStatus }: ContentChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [includePreview, setIncludePreview] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (messageText?: string) => {
    const message = messageText || input.trim();
    if (!message || loading) return;

    setInput('');
    setError('');

    const userMessage: Message = { role: 'user', content: message };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      const conversationHistory = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await api.chatWithContent(contentId, {
        message,
        currentContent,
        conversationHistory,
        includePreview,
      });

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.response,
        explanation: response.explanation,
        diff: response.diff,
        updatedContent: response.updatedContent,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleApply = (content: string) => {
    onApplyChanges(content);
  };

  const hasFailedComponents = componentStatus && componentStatus.some(s => !s.success);

  return (
    <div className="bg-white rounded-lg shadow flex flex-col h-[500px]">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">AI Editor</h3>
            <p className="text-xs text-gray-500">Ask Claude to help edit this content</p>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={includePreview}
              onChange={(e) => setIncludePreview(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-gray-600">Include preview context</span>
          </label>
          {includePreview && (
            <span className="text-xs text-blue-600">(AI can see rendered HTML + component status)</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-sm text-gray-500">
            <p className="mb-3">Try asking:</p>
            <div className="space-y-2">
              {EXAMPLE_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(prompt)}
                  className="block w-full text-left px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded text-gray-700 text-xs"
                >
                  "{prompt}"
                </button>
              ))}
            </div>
            {hasFailedComponents && (
              <>
                <p className="mt-4 mb-2 text-yellow-600 font-medium">Component diagnostics:</p>
                <div className="space-y-2">
                  {PREVIEW_PROMPTS.map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setIncludePreview(true);
                        sendMessage(prompt);
                      }}
                      className="block w-full text-left px-3 py-2 bg-yellow-50 hover:bg-yellow-100 rounded text-yellow-700 text-xs"
                    >
                      "{prompt}"
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={msg.role === 'user' ? 'ml-8' : 'mr-8'}
            >
              <div
                className={'rounded-lg p-3 text-sm ' + (msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800')}
              >
                {msg.role === 'assistant' && msg.explanation ? (
                  <div>
                    <p className="mb-2">{msg.explanation}</p>
                    {msg.diff && (
                      <div className="mt-3 bg-gray-800 text-gray-100 p-2 rounded text-xs font-mono overflow-x-auto">
                        <pre className="whitespace-pre-wrap">{msg.diff}</pre>
                      </div>
                    )}
                    {msg.updatedContent && (
                      <button
                        onClick={() => handleApply(msg.updatedContent!)}
                        className="mt-3 w-full px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-xs font-medium"
                      >
                        Apply Changes
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="mr-8">
            <div className="bg-gray-100 rounded-lg p-3 text-sm text-gray-500 flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
              Thinking...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-50 text-red-600 text-xs">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="border-t p-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Claude to edit the content..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
            rows={2}
            disabled={loading}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
