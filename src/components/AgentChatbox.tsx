import React, { useState } from 'react';
import { Ollama } from 'ollama/browser';
import { ApiConfig, ChatMessage, KnowledgeDocument } from '../types/app';
import { searchDocuments } from '../utils/documentIngestion';

interface AgentChatboxProps {
  apiConfig: ApiConfig;
  documents: KnowledgeDocument[];
}

export const AgentChatbox: React.FC<AgentChatboxProps> = ({ apiConfig, documents }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', role: 'assistant', content: 'I help analyze business performance, manage risk, and find ways to improve profit and control costs. Ask a question or upload business data to get started.', timestamp: new Date() },
  ]);

  const handleSend = async () => {
    const userInput = input.trim();
    if (!userInput) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userInput,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    const addAssistantMessage = (content: string) => {
      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: 'assistant', content, timestamp: new Date() },
      ]);
    };

    const previousUserQuestion = [...messages]
      .reverse()
      .find((message) => message.role === 'user')?.content;
    const isFollowUp =
      userInput.length < 80 ||
      /^(why|how|explain|expand|elaborate|what about|and|can you|tell me more)\b/i.test(userInput);
    const retrievalQuery =
      isFollowUp && previousUserQuestion
        ? `${previousUserQuestion}\n${userInput}`
        : userInput;
    const retrievedContext = searchDocuments(documents, retrievalQuery);

    try {
      const ollama = new Ollama({ host: apiConfig.hostUrl });
      const conversationHistory = messages
        .filter(
          (message): message is ChatMessage & { role: 'user' | 'assistant' } =>
            message.role === 'user' || message.role === 'assistant'
        )
        .map(({ role, content }) => ({ role, content }));
      const response = await ollama.chat({
        model: apiConfig.modelName,
        messages: [
          ...conversationHistory,
          {
            role: 'user',
            content: [
              isFollowUp && previousUserQuestion
                ? `Previous question: ${previousUserQuestion}`
                : '',
              `Current question: ${userInput}`,
              retrievedContext ? 'Retrieved document excerpts:' : '',
              retrievedContext,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        options: {
          temperature: apiConfig.temperature,
          num_ctx: apiConfig.contextWindow,
        },
      });

      const answer = response.message.content.trim();
      if (!answer) {
        throw new Error('The local model returned an empty response.');
      }
      addAssistantMessage(answer);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      addAssistantMessage(
        `Unable to reach the configured Ollama endpoint at ${apiConfig.hostUrl}. Ensure the endpoint is available and the selected model is installed. Details: ${errorMessage}`
      );
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        width: '380px',
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        border: '1px solid #cbd5e1',
        display: 'flex',
        flexDirection: 'column',
        height: isOpen ? '500px' : '48px',
        transition: 'height 0.3s ease',
        zIndex: 1000,
      }}
    >
      {/* Header */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '12px 16px',
          backgroundColor: '#0f172a',
          color: '#ffffff',
          borderRadius: '12px 12px 0 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>🤖</span>
          <strong style={{ fontSize: '0.875rem' }}>AnalytiCore Business Analyst</strong>
        </div>
        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{isOpen ? '▼' : '▲'}</span>
      </div>

      {isOpen && (
        <>
          {/* Chat Body */}
          <div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  backgroundColor: m.role === 'user' ? '#0284c7' : '#f1f5f9',
                  color: m.role === 'user' ? '#ffffff' : '#0f172a',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  maxWidth: '85%',
                  fontSize: '0.875rem',
                  lineHeight: '1.4',
                }}
              >
                {m.content}
              </div>
            ))}
          </div>

          {/* Input Controls */}
          <div style={{ padding: '12px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask about business performance, costs, or risk..."
              style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.875rem', outline: 'none' }}
            />
            <button
              onClick={handleSend}
              style={{
                padding: '8px 14px',
                backgroundColor: '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default AgentChatbox;
