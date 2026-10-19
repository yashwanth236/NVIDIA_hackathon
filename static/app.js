const fileInput = document.getElementById('file-input');
const questionInput = document.getElementById('question-input');
const analyzeButton = document.getElementById('analyze-button');
const readAloudButton = document.getElementById('read-aloud-button');
const stopSpeechButton = document.getElementById('stop-speech-button');
const statusPill = document.getElementById('status-pill');
const fileMeta = document.getElementById('file-meta');
const answerBox = document.getElementById('answer-box');
const stepsList = document.getElementById('steps-list');
const processingIndicator = document.getElementById('processing-indicator');
const confidenceTag = document.getElementById('confidence-tag');

let currentDocumentText = '';
let currentFileName = '';

function setStatus(status, tone = 'neutral', message = '') {
  statusPill.className = `status-pill ${tone}`;
  statusPill.textContent = status;
  if (message) {
    fileMeta.textContent = message;
  }
}

function assessQuestionRisk(question) {
  const prompt = (question || '').toLowerCase();
  const highRiskKeywords = [
    'submit',
    'send',
    'share',
    'delete',
    'password',
    'account',
    'payment',
    'bank',
    'transfer',
    'approve',
    'confirm',
    'sign in',
    'sign up',
    'apply',
    'purchase',
    'message',
    'email',
  ];

  return highRiskKeywords.some((keyword) => prompt.includes(keyword));
}

function renderAnswer(answer, steps, uncertainty, riskLevel = 'low') {
  answerBox.classList.remove('empty');
  answerBox.textContent = answer;
  stepsList.innerHTML = '';

  if (Array.isArray(steps) && steps.length > 0) {
    const listItems = steps.map((step) => {
      const item = document.createElement('li');
      item.textContent = step;
      return item;
    });

    listItems.forEach((item) => stepsList.appendChild(item));
  }

  if (uncertainty) {
    const note = document.createElement('li');
    note.textContent = uncertainty;
    stepsList.appendChild(note);
  }

  if (riskLevel === 'high') {
    const riskNote = document.createElement('li');
    riskNote.textContent = 'Human approval required before any consequential action is taken.';
    stepsList.appendChild(riskNote);
  }

  if (answer.toLowerCase().includes('could not find') || answer.toLowerCase().includes('may be incomplete')) {
    confidenceTag.className = 'confidence-tag warning';
    confidenceTag.textContent = 'Uncertain';
  } else {
    confidenceTag.className = 'confidence-tag success';
    confidenceTag.textContent = 'Grounded';
  }
}

function setProcessing(isProcessing) {
  processingIndicator.classList.toggle('hidden', !isProcessing);
  analyzeButton.disabled = isProcessing;
  analyzeButton.textContent = isProcessing ? 'Processing...' : 'Explain with AccessMate';
}

async function analyzeDocument(file) {
  if (!file) {
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  setStatus('Processing', 'warning', `${file.name} is being analyzed`);
  setProcessing(true);

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'Unable to process the file.');
    }

    currentDocumentText = data.text || 'No readable text was found in the uploaded document.';
    currentFileName = data.file_name || file.name;
    setStatus('Document ready', 'success', `${currentFileName} (${data.page_count || 1} page${(data.page_count || 1) === 1 ? '' : 's'})`);

    if (!questionInput.value.trim()) {
      questionInput.value = 'What are the most important instructions or deadlines in this document?';
    }

    answerBox.classList.add('empty');
    answerBox.textContent = 'Document ready. Ask a question to get a grounded explanation.';
    stepsList.innerHTML = '';
    confidenceTag.className = 'confidence-tag neutral';
    confidenceTag.textContent = 'Ready';
  } catch (error) {
    setStatus('Error', 'error', error.message || 'The upload could not be processed.');
    answerBox.classList.remove('empty');
    answerBox.textContent = error.message || 'The document could not be processed.';
    stepsList.innerHTML = '';
    confidenceTag.className = 'confidence-tag error';
    confidenceTag.textContent = 'Error';
  } finally {
    setProcessing(false);
  }
}

async function submitQuestion() {
  const question = questionInput.value.trim();
  if (!question) {
    answerBox.classList.remove('empty');
    answerBox.textContent = 'Please enter a question to get help understanding the document.';
    confidenceTag.className = 'confidence-tag warning';
    confidenceTag.textContent = 'Missing question';
    return;
  }

  if (!currentDocumentText) {
    answerBox.classList.remove('empty');
    answerBox.textContent = 'Please upload a document before asking a question.';
    confidenceTag.className = 'confidence-tag warning';
    confidenceTag.textContent = 'Upload first';
    return;
  }

  const requiresConfirmation = assessQuestionRisk(question);
  if (requiresConfirmation) {
    const approved = window.confirm(
      'This request may involve a consequential action or sensitive data. Approval from a human is required before proceeding. Continue?'
    );

    if (!approved) {
      answerBox.classList.remove('empty');
      answerBox.textContent = 'Action paused for human review. Only low-risk, informational requests can proceed automatically.';
      confidenceTag.className = 'confidence-tag warning';
      confidenceTag.textContent = 'Needs approval';
      setStatus('Awaiting approval', 'warning', 'Human supervision required');
      return;
    }
  }

  setProcessing(true);
  setStatus('Thinking', 'warning', 'AccessMate is checking the document context');

  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question,
        document_text: currentDocumentText,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'Unable to answer the question.');
    }

    renderAnswer(
      data.answer || 'No answer available.',
      data.steps || [],
      data.uncertainty || '',
      data.risk_level || 'low'
    );
    setStatus('Answered', 'success', `Asked about ${currentFileName || 'the uploaded document'}`);
  } catch (error) {
    answerBox.classList.remove('empty');
    answerBox.textContent = error.message || 'The assistant could not answer that question right now.';
    confidenceTag.className = 'confidence-tag error';
    confidenceTag.textContent = 'Error';
    setStatus('Error', 'error', error.message || 'Unable to answer the question.');
  } finally {
    setProcessing(false);
  }
}

fileInput.addEventListener('change', (event) => {
  const [file] = event.target.files || [];
  if (file) {
    analyzeDocument(file);
  }
});

analyzeButton.addEventListener('click', submitQuestion);

readAloudButton.addEventListener('click', () => {
  const text = answerBox.textContent.trim();
  if (!text || text === 'Upload a document and ask a question to see a clear explanation here.' || text === 'Document ready. Ask a question to get a grounded explanation.') {
    return;
  }

  if (!('speechSynthesis' in window)) {
    answerBox.textContent = 'Text-to-speech is not supported in this browser. You can still read the answer in the panel.';
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
  setStatus('Speaking', 'success', 'Read aloud is active');
});

stopSpeechButton.addEventListener('click', () => {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  setStatus('Ready', 'neutral', 'Speech stopped');
});

window.addEventListener('online', () => setStatus('Online', 'success', 'Connection restored'));
window.addEventListener('offline', () => setStatus('Offline', 'warning', 'Connection unavailable'));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/static/service-worker.js').catch(() => {});
  });
}
