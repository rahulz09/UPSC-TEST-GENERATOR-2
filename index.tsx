import { GoogleGenAI, Type } from "@google/genai";
import * as pdfjsLib from 'pdfjs-dist';

// --- Type Definitions ---
interface Question {
    question: string;
    options: string[];
    answer: number; // 0-indexed integer for the correct option
    explanation: string;
    subject: string;
    topic: string;
}

interface Test {
    id: string;
    name: string;
    questions: Question[];
    duration: number; // in minutes
    language: string;
    createdAt: string;
    marksPerQuestion: number;
    negativeMarking: number;
}

interface TestAttempt {
    testId: string;
    testName: string;
    userAnswers: (number | null)[];
    timeTaken: number; // in seconds
    timePerQuestion: number[]; // in seconds for each question
    completedAt: string;
    score: number;
    totalQuestions: number;
    correctAnswers: number;
    incorrectAnswers: number;
    unanswered: number;
    fullTest: Test;
}

type QuestionStatus = 'notVisited' | 'notAnswered' | 'answered' | 'marked' | 'markedAndAnswered';

// --- PDF.js Worker Setup ---
// This is crucial for performance and to prevent errors.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.4.168/build/pdf.worker.mjs`;

// --- DOM Elements ---
const mainView = document.querySelector('main');
// View Sections
const createTestView = document.getElementById('create-test-view');
const editTestView = document.getElementById('edit-test-view');
const allTestsView = document.getElementById('all-tests-view');
const testDetailView = document.getElementById('test-detail-view');
const testAttemptView = document.getElementById('test-attempt-view');
const performanceView = document.getElementById('performance-view');
const performanceReportView = document.getElementById('performance-report-view');
const analyticsView = document.getElementById('analytics-view');

// Main Page Cards
const createTestCard = document.querySelector('.card[aria-labelledby="create-test-title"]');
const allTestsCard = document.querySelector('.card[aria-labelledby="all-tests-title"]');
const performanceCard = document.querySelector('.card[aria-labelledby="performance-title"]');
const analyticsCard = document.querySelector('.card[aria-labelledby="analytics-title"]');

// Data Control Elements
const backupDataBtn = document.getElementById('backup-data-btn');
const restoreDataBtn = document.getElementById('restore-data-btn');
const restoreFileInput = document.getElementById('restore-file-input') as HTMLInputElement;

// Back Buttons
const backToHomeFromCreateBtn = document.getElementById('back-to-home-from-create');
const backToHomeFromAllTestsBtn = document.getElementById('back-to-home-from-all-tests');
const backToHomeFromPerformanceBtn = document.getElementById('back-to-home-from-performance');
const backToHomeFromAnalyticsBtn = document.getElementById('back-to-home-from-analytics');
const backToCreateBtn = document.getElementById('back-to-create');
const backToAllTestsFromDetailBtn = document.getElementById('back-to-all-tests-from-detail');
const backToPerformanceListBtn = document.getElementById('back-to-performance-list');

// Create Test View Elements
const tabs = document.querySelectorAll('.tab-button');
const tabPanes = document.querySelectorAll('.tab-pane');
let activeTabInput = { type: 'topic', value: '' };
const topicInput = document.getElementById('topic-input') as HTMLInputElement;
const questionsSlider = document.getElementById('questions-slider') as HTMLInputElement;
const questionsCount = document.getElementById('questions-count');
const languageSelect = document.getElementById('language-select') as HTMLSelectElement;
const durationInput = document.getElementById('duration-input') as HTMLInputElement;
const marksInput = document.getElementById('marks-input') as HTMLInputElement;
const negativeInput = document.getElementById('negative-input') as HTMLSelectElement;
const testNameInput = document.getElementById('test-name-input') as HTMLInputElement;
const fileUpload = document.getElementById('file-upload') as HTMLInputElement;
const textInput = document.getElementById('text-input') as HTMLTextAreaElement;
const manualInput = document.getElementById('manual-input') as HTMLTextAreaElement;
const generateTestBtn = document.getElementById('generate-test-btn') as HTMLButtonElement;
const loader = document.getElementById('loader');

// Edit Test View Elements
const editTestTitle = editTestView.querySelector('h2');
const editableQuestionsContainer = document.getElementById('editable-questions-container');
const addQuestionBtn = document.getElementById('add-question-btn');
const saveTestBtn = document.getElementById('save-test-btn');

// All Tests View Elements
const allTestsContainer = document.getElementById('all-tests-container');
const importTestBtn = document.getElementById('import-test-btn');
const importTestInput = document.getElementById('import-test-input') as HTMLInputElement;

// Test Detail View Elements
const testDetailContainer = document.getElementById('test-detail-container');
const testDetailTitle = document.getElementById('test-detail-title');
const testDetailActions = document.getElementById('test-detail-actions');

// Test Attempt View Elements
const attemptTestTitle = document.getElementById('attempt-test-title');
const timeLeftEl = document.getElementById('time-left');
const questionContentContainer = document.getElementById('question-content');
const questionPaletteContainer = document.getElementById('question-palette');
const saveNextBtn = document.getElementById('save-next-btn') as HTMLButtonElement;
const markReviewBtn = document.getElementById('mark-review-btn') as HTMLButtonElement;
const clearResponseBtn = document.getElementById('clear-response-btn') as HTMLButtonElement;
const testSidebar = document.getElementById('test-sidebar');
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');

// Performance View Elements
const performanceContainer = document.getElementById('performance-container');
const performanceReportTitle = document.getElementById('performance-report-title');
const performanceSummaryContainer = document.getElementById('performance-summary-container');
// New Tab Containers
const timeAnalysisContainer = document.getElementById('time-analysis-view');
const subjectBreakdownContainer = document.getElementById('subject-breakdown-view');
const mistakesReviewContainer = document.getElementById('mistakes-view');
const allQuestionsReviewContainer = document.getElementById('all-questions-view');
const downloadReportBtn = document.getElementById('download-report-btn');

// Analytics View Elements
const analyticsStatsGrid = document.getElementById('analytics-stats-grid');
const subjectMasteryContainer = document.getElementById('subject-mastery-container');
const analyticsModal = document.getElementById('analytics-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const modalSubjectTitle = document.getElementById('modal-subject-title');
const modalBody = document.getElementById('modal-body');

// --- Test State ---
let currentTest: Test | null = null;
let currentQuestionIndex = 0;
let userAnswers: (number | null)[] = [];
let questionStatuses: QuestionStatus[] = [];
let timerInterval: number | null = null;
let timeRemaining = 0; // in seconds
let timePerQuestion: number[] = [];
let questionStartTime = 0;
let currentAttemptForReport: TestAttempt | null = null;
let reportReturnView: HTMLElement = performanceView;


// --- Gemini AI ---
let ai: GoogleGenAI;
try {
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
} catch (e) {
    console.error("Failed to initialize GoogleGenAI", e);
    alert("Error: Could not initialize AI. Please ensure API_KEY is set correctly.");
}

const questionSchema = {
    type: Type.OBJECT,
    properties: {
        question: { type: Type.STRING },
        options: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "An array of 4 strings representing the options."
        },
        answer: { type: Type.INTEGER, description: "0-indexed integer for the correct option." },
        explanation: { type: Type.STRING },
        subject: { type: Type.STRING, description: "General subject, e.g., History, Geography, Polity." },
        topic: { type: Type.STRING, description: "Specific topic within the subject." },
    },
    required: ["question", "options", "answer", "explanation", "subject", "topic"]
};

// --- Local Storage Utilities ---
function getFromStorage<T>(key: string, defaultValue: T): T {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
        console.error(`Error reading from localStorage key “${key}”:`, error);
        return defaultValue;
    }
}

function saveToStorage<T>(key: string, value: T): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.error(`Error writing to localStorage key “${key}”:`, error);
    }
}

// --- Data Backup & Restore Logic ---
backupDataBtn.addEventListener('click', () => {
    const backupData = {
        tests: getFromStorage('tests', []),
        performanceHistory: getFromStorage('performanceHistory', [])
    };

    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    
    a.href = url;
    a.download = `upsc_generator_backup_${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

restoreDataBtn.addEventListener('click', () => {
    restoreFileInput.click();
});

restoreFileInput.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const text = e.target?.result as string;
            let data;
            try {
                data = JSON.parse(text);
            } catch (err) {
                throw new Error("The selected file is not a valid JSON file.");
            }

            // Case 1: Full Backup (contains 'tests' or 'performanceHistory' arrays)
            const isBackup = Array.isArray(data.tests) || Array.isArray(data.performanceHistory);
            
            // Case 2: Single Test Export (contains 'questions' array and 'name')
            const isSingleTest = data.name && Array.isArray(data.questions);

            if (isBackup) {
                if (confirm("This will merge the uploaded backup data with your current data. Duplicates will be handled automatically where possible. Continue?")) {
                    const currentTests = getFromStorage<Test[]>('tests', []);
                    const currentHistory = getFromStorage<TestAttempt[]>('performanceHistory', []);
                    
                    const newTests = Array.isArray(data.tests) ? [...data.tests, ...currentTests] : currentTests;
                    const newHistory = Array.isArray(data.performanceHistory) ? [...data.performanceHistory, ...currentHistory] : currentHistory;

                    // De-duplicate tests based on ID
                    const uniqueTests = Array.from(new Map(newTests.map(item => [item.id, item])).values());
                    
                    saveToStorage('tests', uniqueTests);
                    saveToStorage('performanceHistory', newHistory);

                    alert("Data restored successfully!");
                    // Reload current view if necessary
                    if (!allTestsView.classList.contains('hidden')) renderAllTests();
                    if (!performanceView.classList.contains('hidden')) renderPerformanceHistory();
                    if (!analyticsView.classList.contains('hidden')) renderAnalyticsDashboard();
                }
            } 
            else if (isSingleTest) {
                if (confirm(`This file appears to be a single test: "${data.name}". Would you like to import it?`)) {
                     const newTest: Test = {
                        ...data,
                        id: `test_${Date.now()}_restored`, // Ensure unique ID to prevent conflicts
                        name: `${data.name} (Restored)`
                    };

                    const tests = getFromStorage<Test[]>('tests', []);
                    tests.unshift(newTest);
                    saveToStorage('tests', tests);

                    alert(`Test "${data.name}" imported successfully!`);
                    if (!allTestsView.classList.contains('hidden')) renderAllTests();
                }
            } 
            else {
                throw new Error("Invalid file format. Please upload a valid Backup JSON or a single Test JSON.");
            }

        } catch (error) {
            console.error("Error restoring data:", error);
            alert(`Failed to restore data. ${error.message}`);
        } finally {
            input.value = ''; // Reset input
        }
    };
    reader.readAsText(file);
});


// --- View Management ---
const views = [mainView, createTestView, editTestView, allTestsView, testDetailView, testAttemptView, performanceView, performanceReportView, analyticsView];

function showView(viewToShow) {
    views.forEach(view => {
        if (view === viewToShow) {
            view.classList.remove('hidden');
        } else {
            view.classList.add('hidden');
        }
    });
    window.scrollTo(0, 0);
}

// --- Event Listeners for navigation ---
createTestCard.addEventListener('click', () => showView(createTestView));
allTestsCard.addEventListener('click', () => {
    renderAllTests();
    showView(allTestsView);
});
performanceCard.addEventListener('click', () => {
    renderPerformanceHistory();
    showView(performanceView);
});
analyticsCard.addEventListener('click', () => {
    renderAnalyticsDashboard();
    showView(analyticsView);
});

backToHomeFromCreateBtn.addEventListener('click', () => showView(mainView));
backToHomeFromAllTestsBtn.addEventListener('click', () => showView(mainView));
backToHomeFromPerformanceBtn.addEventListener('click', () => showView(mainView));
backToHomeFromAnalyticsBtn.addEventListener('click', () => showView(mainView));
backToCreateBtn.addEventListener('click', () => showView(createTestView));
backToAllTestsFromDetailBtn.addEventListener('click', () => showView(allTestsView));

backToPerformanceListBtn.addEventListener('click', () => {
    if (reportReturnView === performanceView) renderPerformanceHistory();
    else if (reportReturnView === allTestsView) renderAllTests();
    showView(reportReturnView);
});

closeModalBtn.addEventListener('click', () => {
    analyticsModal.classList.add('hidden');
});

// Close modal when clicking outside
analyticsModal.addEventListener('click', (e) => {
    if (e.target === analyticsModal) {
        analyticsModal.classList.add('hidden');
    }
});

// Sidebar toggle for mobile test attempt view
toggleSidebarBtn?.addEventListener('click', () => {
    testSidebar?.classList.toggle('collapsed');
});

// --- GLOBAL DELEGATED EVENT LISTENERS ---
document.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    // Test Attempt View Controls
    if (!testAttemptView.classList.contains('hidden')) {
        if (target.closest('#submit-test-btn')) {
            e.preventDefault();
            handleSubmitTest();
        } else if (target.closest('#back-to-all-tests')) {
            e.preventDefault();
            const timerWasRunning = timerInterval !== null;
            if (timerWasRunning) stopTimer();
            if (confirm("Are you sure you want to abandon this test? Your progress will be lost.")) {
                currentTest = null;
                showView(allTestsView);
            } else {
                if (timerWasRunning) startTimer();
            }
        }
        return;
    }
    
    // Deeper Analysis Button in Performance Report
    if (target.matches('.deeper-analysis-btn')) {
        await handleDeeperAnalysis(target);
    }
});


// --- KEYBOARD SHORTCUTS FOR TEST ATTEMPT ---
document.addEventListener('keydown', (e) => {
    if (testAttemptView.classList.contains('hidden')) {
        return;
    }

    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
    }

    switch (e.key) {
        case '1':
        case '2':
        case '3':
        case '4':
            e.preventDefault();
            const optionIndex = parseInt(e.key, 10) - 1;
            const radioButtons = document.querySelectorAll('.attempt-option-item input[type="radio"]') as NodeListOf<HTMLInputElement>;
            if (radioButtons[optionIndex]) {
                radioButtons[optionIndex].checked = true;
            }
            break;

        case ' ': // Spacebar for Save & Next
            e.preventDefault();
            saveNextBtn.click();
            break;

        case 'm':
        case 'M':
            e.preventDefault();
            markReviewBtn.click();
            break;
            
        case 'c':
        case 'C':
            e.preventDefault();
            clearResponseBtn.click();
            break;
    }
});


// --- Create Test Logic ---
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        
        const tabName = tab.getAttribute('data-tab');
        activeTabInput.type = tabName;

        tabPanes.forEach(pane => {
            if (pane.id === `${tabName}-content`) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });
    });
});

questionsSlider.addEventListener('input', () => {
    questionsCount.textContent = questionsSlider.value;
});

generateTestBtn.addEventListener('click', handleGenerateTest);

async function handleGenerateTest() {
    if (!ai) {
        alert("AI Service is not available.");
        return;
    }

    loader.classList.remove('hidden');
    generateTestBtn.disabled = true;

    let source = "Custom Input";
    let contentsForApi;

    const numQuestions = parseInt(questionsSlider.value, 10);
    const language = languageSelect.value;
    const testName = testNameInput.value.trim();
    const marks = parseFloat(marksInput.value) || 1;
    const negative = parseFloat(negativeInput.value) || 0;

    try {
        switch (activeTabInput.type) {
            case 'topic':
                const topic = topicInput.value.trim();
                if (!topic) throw new Error('Please enter a topic.');
                source = topic;
                const promptTopic = `Generate ${numQuestions} UPSC-style multiple-choice questions (4 options) based on the following topic: ${topic}. The questions should be in ${language}. For each question, provide the question, four options, the 0-indexed correct answer, a detailed explanation, the general subject, and the specific topic.`;
                contentsForApi = promptTopic;
                break;
            case 'text':
                const text = textInput.value.trim();
                if (!text) throw new Error('Please paste some text.');
                source = "Pasted Text";
                const promptText = `Generate ${numQuestions} UPSC-style multiple-choice questions (4 options) based on the following text: """${text}""". The questions should be in ${language}. For each question, provide the question, four options, the 0-indexed correct answer, a detailed explanation, the general subject, and the specific topic.`;
                contentsForApi = promptText;
                break;
            case 'manual':
                const manualText = manualInput.value.trim();
                if (!manualText) throw new Error('Please paste your questions in the text area.');
                source = "Bulk Import";
                const promptManual = `Analyze the following text and extract ALL multiple-choice questions found within it.
                
                The text is expected to contain questions in a format similar to:
                "Q. Question text... A) Opt1 B) Opt2... Answer: A Explanation: ..."
                
                Your task:
                1. Extract every valid question.
                2. Map options to a string array.
                3. Determine the correct answer index (0 for A/1, 1 for B/2, etc).
                4. Extract explanation if present, otherwise generate a brief one.
                5. Extract Subject and Topic if present, otherwise infer them from the question content.
                6. Return the result strictly as a JSON array matching the schema.
                
                Input Text:
                """${manualText}"""`;
                contentsForApi = promptManual;
                break;
            case 'file':
                const file = fileUpload.files[0];
                if (!file) throw new Error('Please select a file to upload.');
                source = file.name;

                if (file.type === "text/plain" || file.name.toLowerCase().endsWith('.txt')) {
                    const fileText = await file.text();
                    if (!fileText.trim()) throw new Error('The uploaded file is empty.');
                    const promptFileText = `Generate ${numQuestions} ... based on the following text: """${fileText}"""`;
                    contentsForApi = promptFileText;
                } else if (file.type === "application/pdf" || file.name.toLowerCase().endsWith('.pdf')) {
                    const arrayBuffer = await file.arrayBuffer();
                    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
                    let fullText = '';
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const textContent = await page.getTextContent();
                        const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ');
                        fullText += pageText + '\n\n';
                    }

                    const MINIMUM_TEXT_LENGTH = 100;

                    if (fullText.trim().length > MINIMUM_TEXT_LENGTH) {
                        const promptPDFText = `Generate ${numQuestions} UPSC-style multiple-choice questions (4 options) based on the following text. The questions should be in ${language}. For each question, provide the question, four options, the 0-indexed correct answer, a detailed explanation, the general subject, and the specific topic.\n\nText: """${fullText}"""`;
                        contentsForApi = promptPDFText;
                    } else {
                        (loader.querySelector('p') as HTMLElement).textContent = 'Minimal text found. Attempting OCR on PDF pages for better results...';
                        
                        const textPart = { text: `Generate ${numQuestions} UPSC-style multiple-choice questions (4 options) based on the content in the following images. The questions should be in ${language}. For each question, provide the question, four options, the 0-indexed correct answer, a detailed explanation, the general subject, and the specific topic.` };
                        const imageParts = [];

                        for (let i = 1; i <= pdf.numPages; i++) {
                            const page = await pdf.getPage(i);
                            const viewport = page.getViewport({ scale: 1.5 });
                            const canvas = document.createElement('canvas');
                            const context = canvas.getContext('2d');
                            canvas.height = viewport.height;
                            canvas.width = viewport.width;

                            await page.render({ canvasContext: context, viewport: viewport, canvas: canvas } as any).promise;
                            
                            const base64Image = canvas.toDataURL('image/jpeg').split(',')[1];
                            imageParts.push({ inlineData: { mimeType: 'image/jpeg', data: base64Image } });
                        }
                        if (imageParts.length === 0) throw new Error('Could not extract any images from the PDF.');

                        contentsForApi = { parts: [textPart, ...imageParts] };
                    }
                } else {
                    throw new Error(`Unsupported file type: '${file.type || 'unknown'}'. Please upload a PDF or TXT file.`);
                }
                break;
        }

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: contentsForApi,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: questionSchema,
                },
            },
        });

        if (!response || !response.text) {
            console.error("Invalid AI Response:", response);
            const finishReason = response?.candidates?.[0]?.finishReason;
            let errorMessage = "AI did not return a valid response. It might be empty or malformed.";
            if (finishReason === 'SAFETY') {
                errorMessage = "The request was blocked due to safety concerns. Please adjust your input text or file.";
            } else if (finishReason) {
                errorMessage = `Generation failed. Reason: ${finishReason}.`;
            }
            throw new Error(errorMessage);
        }

        const parsedResponse = JSON.parse(response.text);

        if (!Array.isArray(parsedResponse) || parsedResponse.length === 0) {
            throw new Error("Invalid response format from AI. The generated content was not a valid list of questions.");
        }

        currentTest = {
            id: `test_${Date.now()}`,
            name: testName || `Test on ${source}`,
            questions: parsedResponse,
            duration: parseInt(durationInput.value, 10),
            language: language,
            createdAt: new Date().toISOString(),
            marksPerQuestion: marks,
            negativeMarking: negative
        };

        renderEditableTest(currentTest);
        showView(editTestView);
    } catch (error) {
        console.error("Error generating test:", error);
        alert(`Failed to generate test. ${error.message}`);
    } finally {
        (loader.querySelector('p') as HTMLElement).textContent = 'Generating your test, please wait...';
        loader.classList.add('hidden');
        generateTestBtn.disabled = false;
    }
}


// --- Edit Test Logic ---
function renderEditableTest(test: Test) {
    editTestTitle.textContent = `Review & Edit: ${test.name}`;
    
    // We render using a details/summary structure (or similar) to make it collapsible.
    // However, native <details> with form inputs can be tricky if we want to programmatically open/close,
    // so we'll use a custom structure with delegated events.
    
    editableQuestionsContainer.innerHTML = test.questions.map((q, index) => `
        <div class="editable-question-item" data-question-index="${index}" id="eq-${index}">
            <div class="editable-question-header">
                <h4>Question ${index + 1}</h4>
                <div class="editable-question-actions">
                    <button class="icon-btn delete-q" title="Delete Question">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                    <button class="icon-btn toggle-q" title="Expand/Collapse">
                        <span class="material-symbols-outlined">expand_more</span>
                    </button>
                </div>
            </div>
            
            <div class="editable-question-body hidden">
                <label for="q-text-${index}">Question Text</label>
                <textarea id="q-text-${index}">${q.question}</textarea>
                
                <label>Options (Select Correct Answer)</label>
                <div class="options-editor">
                    ${q.options.map((opt, optIndex) => `
                        <div class="option-item">
                            <input type="radio" name="q-answer-${index}" value="${optIndex}" ${q.answer === optIndex ? 'checked' : ''}>
                            <input type="text" value="${opt}" placeholder="Option ${optIndex + 1}">
                        </div>
                    `).join('')}
                </div>
                
                <div class="meta-grid">
                    <div>
                        <label for="q-subject-${index}">Subject</label>
                        <input type="text" id="q-subject-${index}" value="${q.subject}">
                    </div>
                    <div>
                        <label for="q-topic-${index}">Topic</label>
                        <input type="text" id="q-topic-${index}" value="${q.topic}">
                    </div>
                </div>
                
                <label for="q-exp-${index}">Explanation</label>
                <textarea id="q-exp-${index}">${q.explanation}</textarea>
            </div>
        </div>
    `).join('');

    // Open first question by default
    const firstItem = document.getElementById('eq-0');
    if (firstItem) {
        firstItem.setAttribute('open', '');
        firstItem.querySelector('.editable-question-body').classList.remove('hidden');
        firstItem.querySelector('.toggle-q span').textContent = 'expand_less';
    }
}

// Delegated events for the editable container (Delete & Toggle)
editableQuestionsContainer.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    
    // Handle Delete
    const deleteBtn = target.closest('.delete-q');
    if (deleteBtn) {
        e.stopPropagation();
        const item = deleteBtn.closest('.editable-question-item') as HTMLElement;
        const index = parseInt(item.dataset.questionIndex, 10);
        if (confirm(`Are you sure you want to delete question ${index + 1}?`)) {
            // Update currentTest data
            // We need to sync DOM state to data first before splicing to avoid losing unsaved edits
            syncCurrentTestFromDOM(); 
            currentTest.questions.splice(index, 1);
            renderEditableTest(currentTest); 
        }
        return;
    }

    // Handle Toggle (Header click or button click)
    const header = target.closest('.editable-question-header');
    const toggleBtn = target.closest('.toggle-q');
    
    if (header || toggleBtn) {
        // Prevent toggling if clicked on delete button (already handled but good to be safe)
        if (target.closest('.delete-q')) return;

        const item = target.closest('.editable-question-item') as HTMLElement;
        const isOpen = item.hasAttribute('open');
        const body = item.querySelector('.editable-question-body');
        const icon = item.querySelector('.toggle-q span');
        
        if (isOpen) {
            item.removeAttribute('open');
            body.classList.add('hidden');
            if(icon) icon.textContent = 'expand_more';
        } else {
            item.setAttribute('open', '');
            body.classList.remove('hidden');
            if(icon) icon.textContent = 'expand_less';
        }
    }
});

// Helper to save state from DOM to currentTest object without saving to LocalStorage yet
function syncCurrentTestFromDOM() {
    if (!currentTest) return;
    const questionForms = editableQuestionsContainer.querySelectorAll('.editable-question-item');
    const updatedQuestions: Question[] = [];

    questionForms.forEach((form, index) => {
        // Since we might delete items and re-render, the index in DOM matches currentTest structure *before* deletion
        // but this function is called generally to save state.
        const questionText = (form.querySelector(`#q-text-${index}`) as HTMLTextAreaElement).value;
        const explanationText = (form.querySelector(`#q-exp-${index}`) as HTMLTextAreaElement).value;
        const subjectText = (form.querySelector(`#q-subject-${index}`) as HTMLInputElement).value;
        const topicText = (form.querySelector(`#q-topic-${index}`) as HTMLInputElement).value;
        const answer = parseInt((form.querySelector(`input[name="q-answer-${index}"]:checked`) as HTMLInputElement)?.value ?? '0');
        
        const options = Array.from(form.querySelectorAll('.option-item input[type="text"]')).map(input => (input as HTMLInputElement).value);
        
        updatedQuestions.push({
            question: questionText,
            options,
            answer,
            explanation: explanationText,
            subject: subjectText,
            topic: topicText
        });
    });
    currentTest.questions = updatedQuestions;
}


addQuestionBtn.addEventListener('click', () => {
    if (!currentTest) return;
    syncCurrentTestFromDOM(); // Save current progress
    const newQuestion: Question = {
        question: "",
        options: ["", "", "", ""],
        answer: 0,
        explanation: "",
        subject: "",
        topic: ""
    };
    currentTest.questions.push(newQuestion);
    renderEditableTest(currentTest);
    
    // Automatically open the new question
    const lastIdx = currentTest.questions.length - 1;
    setTimeout(() => {
        const newItem = document.getElementById(`eq-${lastIdx}`);
        if(newItem) {
            newItem.setAttribute('open', '');
            newItem.querySelector('.editable-question-body').classList.remove('hidden');
            newItem.querySelector('.toggle-q span').textContent = 'expand_less';
            newItem.scrollIntoView({ behavior: 'smooth' });
        }
    }, 100);
});


saveTestBtn.addEventListener('click', () => {
    if (!currentTest) return;
    syncCurrentTestFromDOM();

    const tests = getFromStorage<Test[]>('tests', []);
    
    // Check if test already exists (Update mode vs Create mode)
    const existingIndex = tests.findIndex(t => t.id === currentTest.id);
    
    if (existingIndex > -1) {
        tests[existingIndex] = currentTest;
        alert('Test updated successfully!');
    } else {
        tests.unshift(currentTest);
        alert('Test created successfully!');
    }
    
    saveToStorage('tests', tests);
    renderAllTests();
    showView(allTestsView);
});


// --- All Tests & Test Detail Logic ---
function renderAllTests() {
    const tests = getFromStorage<Test[]>('tests', []);
    if (tests.length === 0) {
        allTestsContainer.innerHTML = `<p class="placeholder">You haven't saved any tests yet.</p>`;
        return;
    }
    allTestsContainer.innerHTML = tests.map(test => {
        const dateObj = new Date(test.createdAt);
        const date = dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        
        return `
        <div class="saved-test-item" data-testid="${test.id}">
            <div>
                <h3>${test.name}</h3>
                <p>Created on ${date}</p>
            </div>
            <div class="test-stats-preview">
                 <div class="stat-pill">
                    <span class="material-symbols-outlined">quiz</span> ${test.questions.length} Questions
                 </div>
                 <div class="stat-pill">
                    <span class="material-symbols-outlined">timer</span> ${test.duration} mins
                 </div>
            </div>
            <div class="test-card-actions">
                <button class="start-btn" aria-label="Start Test" title="Start Test">
                     <span class="material-symbols-outlined">play_arrow</span> Start
                </button>
                 <button class="edit-btn" aria-label="Edit Test" title="Edit Test">
                     <span class="material-symbols-outlined">edit</span>
                </button>
                <button class="download-test-btn" aria-label="Download JSON" title="Download">
                     <span class="material-symbols-outlined">download</span>
                </button>
                <button class="delete-btn" aria-label="Delete Test" title="Delete">
                     <span class="material-symbols-outlined">delete</span>
                </button>
            </div>
        </div>
    `}).join('');
}

function handleDownloadTest(test: Test) {
    const jsonString = JSON.stringify(test, null, 2); // Pretty print JSON
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    // Sanitize file name
    const fileName = `test-${test.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;

    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handleDeleteTest(testId: string) {
    if (confirm("Are you sure you want to delete this test?")) {
        let tests = getFromStorage<Test[]>('tests', []);
        tests = tests.filter(t => t.id !== testId);
        saveToStorage('tests', tests);
        renderAllTests(); // Re-render the list
    }
}

function handleEditTest(test: Test) {
    // Deep copy to ensure we don't mutate state unless saved
    currentTest = JSON.parse(JSON.stringify(test));
    renderEditableTest(currentTest);
    showView(editTestView);
}

function handleImportTest(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const text = e.target?.result as string;
            if (!text) throw new Error("File is empty.");

            const importedData = JSON.parse(text);

            // Basic validation
            if (
                typeof importedData.name !== 'string' ||
                typeof importedData.duration !== 'number' ||
                !Array.isArray(importedData.questions)
            ) {
                throw new Error("Invalid test file format. The file must contain a name, duration, and questions array.");
            }

            const newTest: Test = {
                ...importedData,
                id: `test_${Date.now()}`, // Assign a new unique ID
                name: `${importedData.name} (Imported)`, // Mark as imported
                createdAt: new Date().toISOString(), // Set new creation date
                marksPerQuestion: importedData.marksPerQuestion || 1, // Default to 1 if missing in import
                negativeMarking: importedData.negativeMarking || 0
            };

            const tests = getFromStorage<Test[]>('tests', []);
            tests.unshift(newTest);
            saveToStorage('tests', tests);

            alert(`Test "${newTest.name}" imported successfully!`);
            renderAllTests();

        } catch (error) {
            console.error("Error importing test:", error);
            alert(`Failed to import test. ${error.message}`);
        } finally {
            // Reset input value to allow re-uploading the same file
            input.value = '';
        }
    };
    reader.onerror = () => {
         alert('Error reading the file.');
         input.value = '';
    };
    reader.readAsText(file);
}

importTestBtn.addEventListener('click', () => importTestInput.click());
importTestInput.addEventListener('change', handleImportTest);

allTestsContainer.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const testItem = target.closest('.saved-test-item') as HTMLElement;
    if (!testItem) return;

    const testId = testItem.dataset.testid;
    const tests = getFromStorage<Test[]>('tests', []);
    const test = tests.find(t => t.id === testId);
    if (!test) return;

    // Handle clicks on specific buttons
    if (target.closest('.start-btn')) {
        startTest(test);
    } else if (target.closest('.download-test-btn')) {
        handleDownloadTest(test);
    } else if (target.closest('.delete-btn')) {
        handleDeleteTest(testId);
    } else if (target.closest('.edit-btn')) {
        handleEditTest(test);
    } else {
        // If clicked anywhere else on the card (but not on a button), show details
        if (!target.closest('button')) {
             renderTestDetail(test);
             showView(testDetailView);
        }
    }
});

function renderTestDetail(test: Test) {
    currentTest = test;
    testDetailTitle.textContent = test.name;
    testDetailContainer.innerHTML = test.questions.map((q, index) => `
        <div class="test-detail-item">
            <div class="question-header">
                <p>Question ${index + 1}</p>
                <span class="question-meta">${q.subject} > ${q.topic}</span>
            </div>
            <p>${q.question}</p>
            <ul class="detail-options">
                ${q.options.map((opt, optIndex) => `
                    <li class="detail-option-item ${q.answer === optIndex ? 'correct' : ''}">${opt}</li>
                `).join('')}
            </ul>
            <div class="explanation-box">
                <h4>Explanation</h4>
                <p>${q.explanation}</p>
            </div>
        </div>
    `).join('');
}

testDetailActions.addEventListener('click', e => {
    if (!currentTest) return;
    const target = e.target as HTMLElement;

    if (target.closest('#start-test-btn')) {
        startTest(currentTest);
    }
    if (target.closest('#delete-test-btn')) {
        if (confirm(`Are you sure you want to delete the test "${currentTest.name}"? This action cannot be undone.`)) {
            let tests = getFromStorage<Test[]>('tests', []);
            tests = tests.filter(t => t.id !== currentTest.id);
            saveToStorage('tests', tests);
            alert('Test deleted.');
            renderAllTests();
            showView(allTestsView);
        }
    }
});

// --- Test Attempt Logic ---
function startTest(test: Test) {
    currentTest = test;
    currentQuestionIndex = 0;
    userAnswers = Array(test.questions.length).fill(null);
    questionStatuses = Array(test.questions.length).fill('notVisited');
    questionStatuses[0] = 'notAnswered';
    timeRemaining = test.duration * 60;
    timePerQuestion = Array(test.questions.length).fill(0);
    questionStartTime = Date.now();

    attemptTestTitle.textContent = test.name;
    
    renderQuestionForAttempt();
    updatePalette();
    startTimer();
    showView(testAttemptView);
}

function renderQuestionForAttempt() {
    const q = currentTest.questions[currentQuestionIndex];
    questionContentContainer.innerHTML = `
        <h3>Question ${currentQuestionIndex + 1} of ${currentTest.questions.length}</h3>
        <p>${q.question}</p>
        <ul class="attempt-options">
            ${q.options.map((opt, index) => `
                <li class="attempt-option-item">
                    <label>
                        <input type="radio" name="option" value="${index}" ${userAnswers[currentQuestionIndex] === index ? 'checked' : ''}>
                        <span>${opt}</span>
                    </label>
                </li>
            `).join('')}
        </ul>
    `;
}

function updatePalette() {
    questionPaletteContainer.innerHTML = currentTest.questions.map((_, index) => {
        const status = questionStatuses[index];
        const isCurrent = index === currentQuestionIndex;
        return `<button class="palette-btn ${status} ${isCurrent ? 'current' : ''}" data-index="${index}">${index + 1}</button>`;
    }).join('');
}

questionPaletteContainer.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('palette-btn')) {
        const newIndex = parseInt(target.dataset.index, 10);
        if (newIndex !== currentQuestionIndex) {
            navigateToQuestion(newIndex);
        }
    }
});

function saveCurrentAnswer() {
    const selectedOption = document.querySelector('input[name="option"]:checked') as HTMLInputElement;
    userAnswers[currentQuestionIndex] = selectedOption ? parseInt(selectedOption.value, 10) : null;

    const currentStatus = questionStatuses[currentQuestionIndex];
    if (userAnswers[currentQuestionIndex] !== null) {
        questionStatuses[currentQuestionIndex] = currentStatus === 'marked' || currentStatus === 'markedAndAnswered' ? 'markedAndAnswered' : 'answered';
    } else {
        if (currentStatus !== 'marked' && currentStatus !== 'markedAndAnswered') {
            questionStatuses[currentQuestionIndex] = 'notAnswered';
        }
    }
}

function navigateToQuestion(newIndex: number) {
    // Record time for the current (outgoing) question
    if (currentTest) {
        const timeSpent = (Date.now() - questionStartTime) / 1000;
        timePerQuestion[currentQuestionIndex] += timeSpent;
    }

    saveCurrentAnswer(); // Save answer for the outgoing question

    // Handle navigation limits
    if (newIndex >= currentTest.questions.length) {
        updatePalette();
        alert("You have reached the last question.");
        questionStartTime = Date.now(); // Reset timer to stop accumulating time on the last question
        return;
    }
    if (newIndex < 0) {
        // This case shouldn't happen with current UI, but it's good practice
        questionStartTime = Date.now();
        return;
    }

    // Move to the new question
    currentQuestionIndex = newIndex;
    questionStartTime = Date.now(); // Reset timer for the new (incoming) question

    // Update status and render
    if (questionStatuses[currentQuestionIndex] === 'notVisited') {
        questionStatuses[currentQuestionIndex] = 'notAnswered';
    }
    renderQuestionForAttempt();
    updatePalette();
}

saveNextBtn.addEventListener('click', () => navigateToQuestion(currentQuestionIndex + 1));

clearResponseBtn.addEventListener('click', () => {
    const selectedOption = document.querySelector('input[name="option"]:checked') as HTMLInputElement;
    if (selectedOption) selectedOption.checked = false;
});

markReviewBtn.addEventListener('click', () => {
    const currentStatus = questionStatuses[currentQuestionIndex];
    if (currentStatus === 'answered' || currentStatus === 'markedAndAnswered') {
        questionStatuses[currentQuestionIndex] = 'markedAndAnswered';
    } else {
        questionStatuses[currentQuestionIndex] = 'marked';
    }
    navigateToQuestion(currentQuestionIndex + 1);
});

function handleSubmitTest() {
    try {
        stopTimer();
        
        // Record time for the final question and save the final answer
        const timeSpent = (Date.now() - questionStartTime) / 1000;
        timePerQuestion[currentQuestionIndex] += timeSpent;
        saveCurrentAnswer();

        if (!currentTest) {
            console.error("Submission failed: currentTest is not available.");
            alert("A critical error occurred: Test data is missing. Unable to submit.");
            showView(mainView); // Go back to the main menu for safety
            return;
        }

        let correctAnswers = 0;
        let incorrectAnswers = 0;
        let unanswered = 0;
        
        currentTest.questions.forEach((q, index) => {
            if (userAnswers[index] === null) {
                unanswered++;
            } else if (userAnswers[index] === q.answer) {
                correctAnswers++;
            } else {
                incorrectAnswers++;
            }
        });

        const marksPerQ = currentTest.marksPerQuestion || 1;
        const negMark = currentTest.negativeMarking || 0;
        const rawScore = (correctAnswers * marksPerQ) - (incorrectAnswers * negMark);
        const totalMaxScore = currentTest.questions.length * marksPerQ;

        // Calculate percentage based on raw score vs potential max score
        const scorePercentage = totalMaxScore > 0 
            ? Math.max(0, (rawScore / totalMaxScore) * 100) 
            : 0;
        
        const attempt: TestAttempt = {
            testId: currentTest.id,
            testName: currentTest.name,
            userAnswers,
            timeTaken: (currentTest.duration * 60) - timeRemaining,
            timePerQuestion,
            completedAt: new Date().toISOString(),
            score: scorePercentage, // Storing percentage for consistency
            totalQuestions: currentTest.questions.length,
            correctAnswers,
            incorrectAnswers,
            unanswered,
            fullTest: currentTest
        };

        const history = getFromStorage<TestAttempt[]>('performanceHistory', []);
        history.unshift(attempt);
        saveToStorage('performanceHistory', history);

        currentTest = null; // Clear the current test state
        
        // Redirect directly to the full report instead of the history list
        renderPerformanceReport(attempt, false);
        showView(performanceReportView);

    } catch (error) {
        console.error("An unexpected error occurred during test submission:", error);
        alert("An unexpected error occurred while submitting your test. Your progress could not be saved.");
        showView(mainView); // Fallback to main view on error
    }
}

// --- Timer Logic ---
function startTimer() {
    if (timerInterval) window.clearInterval(timerInterval);
    timerInterval = window.setInterval(() => {
        timeRemaining--;
        const hours = Math.floor(timeRemaining / 3600);
        const minutes = Math.floor((timeRemaining % 3600) / 60);
        const seconds = timeRemaining % 60;
        timeLeftEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        
        if (timeRemaining <= 0) {
            stopTimer();
            alert("Time's up! Your test will be submitted automatically.");
            handleSubmitTest();
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) window.clearInterval(timerInterval);
    timerInterval = null;
}

// --- Performance Logic ---
function renderPerformanceHistory() {
    const history = getFromStorage<TestAttempt[]>('performanceHistory', []);
    if (history.length === 0) {
        performanceContainer.innerHTML = `<p class="placeholder">You haven't completed any tests yet.</p>`;
        return;
    }

    performanceContainer.innerHTML = history.map((attempt, index) => {
        const dateObj = new Date(attempt.completedAt);
        const date = dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        const time = dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const scoreClass = attempt.score >= 50 ? 'pass' : 'fail';
        const timeTakenStr = new Date(attempt.timeTaken * 1000).toISOString().substr(14, 5); // MM:SS

        return `
        <div class="history-card" data-attempt-index="${index}">
            <div class="history-info">
                <h3>${attempt.testName}</h3>
                <div class="history-meta">
                    <span title="Date"><span class="material-symbols-outlined">calendar_today</span> ${date} at ${time}</span>
                </div>
            </div>
            <div class="history-stats-preview">
                 <div class="stat-pill">
                    <span class="material-symbols-outlined">check_circle</span> ${attempt.correctAnswers} Correct
                 </div>
                 <div class="stat-pill">
                    <span class="material-symbols-outlined">cancel</span> ${attempt.incorrectAnswers} Incorrect
                 </div>
                 <div class="stat-pill">
                    <span class="material-symbols-outlined">timer</span> ${timeTakenStr}
                 </div>
            </div>
            <div class="history-score-area">
                <div class="score-badge ${scoreClass}">${attempt.score.toFixed(2)}%</div>
                <p class="accuracy-label">Accuracy</p>
            </div>
            <button class="view-test-btn" style="width: 100%; margin-top: 1rem;">
                <span class="material-symbols-outlined">analytics</span> View Detailed Analysis
            </button>
        </div>
    `}).join('');
}

performanceContainer.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest('.history-card') as HTMLElement; 
    if (item) {
        const index = parseInt(item.dataset.attemptIndex, 10);
        const history = getFromStorage<TestAttempt[]>('performanceHistory', []);
        renderPerformanceReport(history[index], true);
        showView(performanceReportView);
    }
});

function renderPerformanceReport(attempt: TestAttempt, fromHistory: boolean = true) {
    currentAttemptForReport = attempt; // Store attempt for deeper analysis
    
    // Update Back button logic based on entry point
    if (fromHistory) {
        reportReturnView = performanceView;
        backToPerformanceListBtn.innerHTML = '<span class="material-symbols-outlined">arrow_back</span> Back to History';
    } else {
        reportReturnView = allTestsView;
        backToPerformanceListBtn.innerHTML = '<span class="material-symbols-outlined">home</span> Back to All Tests';
    }

    performanceReportTitle.textContent = `Result Report for ${attempt.testName}`;
    
    const attemptedCount = attempt.correctAnswers + attempt.incorrectAnswers;
    const accuracy = attemptedCount > 0 ? (attempt.correctAnswers / attemptedCount) * 100 : 0;
    
    // 1. Render Summary Cards
    performanceSummaryContainer.innerHTML = `
        <div class="summary-card score">
            <div class="summary-icon"><span class="material-symbols-outlined">percent</span></div>
            <div class="summary-data">
                <div class="summary-value">${attempt.score.toFixed(2)}%</div>
                <div class="summary-label">Score</div>
            </div>
        </div>
         <div class="summary-card accuracy">
            <div class="summary-icon"><span class="material-symbols-outlined">track_changes</span></div>
            <div class="summary-data">
                <div class="summary-value">${accuracy.toFixed(2)}%</div>
                <div class="summary-label">Accuracy</div>
            </div>
        </div>
        <div class="summary-card correct">
            <div class="summary-icon"><span class="material-symbols-outlined">check_circle</span></div>
            <div class="summary-data">
                <div class="summary-value">${attempt.correctAnswers}</div>
                <div class="summary-label">Correct</div>
            </div>
        </div>
        <div class="summary-card incorrect">
            <div class="summary-icon"><span class="material-symbols-outlined">cancel</span></div>
             <div class="summary-data">
                <div class="summary-value">${attempt.incorrectAnswers}</div>
                <div class="summary-label">Incorrect</div>
            </div>
        </div>
        <div class="summary-card unanswered">
            <div class="summary-icon"><span class="material-symbols-outlined">help</span></div>
             <div class="summary-data">
                <div class="summary-value">${attempt.unanswered}</div>
                <div class="summary-label">Unanswered</div>
            </div>
        </div>
        <div class="summary-card time">
             <div class="summary-icon"><span class="material-symbols-outlined">timer</span></div>
             <div class="summary-data">
                 <div class="summary-value">${(attempt.timeTaken / 60).toFixed(1)}m</div>
                 <div class="summary-label">Time Taken</div>
             </div>
        </div>
    `;

    // 2. Render content into all containers (initially hidden by CSS except active one)
    renderTimeAnalysisCharts(attempt);
    renderSubjectBreakdown(attempt);
    renderMistakesReview(attempt);
    renderAllQuestionsReview(attempt);
    
    // 3. Reset Tab State (Default to Mistake Review)
    const reportTabs = document.querySelectorAll('.report-tab-btn');
    const reportPanes = document.querySelectorAll('.report-tab-pane');

    reportTabs.forEach(tab => tab.classList.remove('active'));
    reportPanes.forEach(pane => pane.classList.remove('active'));

    // Default active: Mistakes Review
    const defaultTab = document.querySelector('.report-tab-btn[data-target="mistakes-view"]');
    if (defaultTab) {
        defaultTab.classList.add('active');
        mistakesReviewContainer.classList.add('active');
    }

    downloadReportBtn.onclick = () => handleDownloadReport(attempt);
}

// Add event delegation for Tab Switching
document.querySelector('.report-tabs-container')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const tabBtn = target.closest('.report-tab-btn');
    
    if (tabBtn) {
        // Remove active class from all tabs and panes
        document.querySelectorAll('.report-tab-btn').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.report-tab-pane').forEach(p => p.classList.remove('active'));
        
        // Add active class to clicked tab
        tabBtn.classList.add('active');
        
        // Show corresponding pane
        const targetId = tabBtn.getAttribute('data-target');
        const targetPane = document.getElementById(targetId);
        if (targetPane) {
            targetPane.classList.add('active');
        }
    }
});


function handleDownloadReport(attempt: TestAttempt) {
    let reportContent = `Result Report for: ${attempt.testName}\n`;
    reportContent += `Completed on: ${new Date(attempt.completedAt).toLocaleString()}\n`;
    reportContent += `========================================\n\n`;

    // Overall Summary
    const attempted = attempt.correctAnswers + attempt.incorrectAnswers;
    const accuracy = attempted > 0 ? (attempt.correctAnswers / attempted) * 100 : 0;
    const timeTakenStr = new Date(attempt.timeTaken * 1000).toISOString().substr(11, 8);
    
    reportContent += `--- Overall Summary ---\n`;
    reportContent += `Score: ${attempt.score.toFixed(2)}%\n`;
    reportContent += `Accuracy (on attempted): ${accuracy.toFixed(2)}%\n`;
    reportContent += `Correct Answers: ${attempt.correctAnswers}\n`;
    reportContent += `Incorrect Answers: ${attempt.incorrectAnswers}\n`;
    reportContent += `Unanswered: ${attempt.unanswered}\n`;
    reportContent += `Total Questions: ${attempt.totalQuestions}\n`;
    reportContent += `Time Taken: ${timeTakenStr}\n\n`;

    // Subject Breakdown
    reportContent += `--- Subject & Topic Breakdown ---\n`;
    const subjectStats: { [key: string]: { correct: number, total: number, topics: { [key: string]: { correct: number, total: number } } } } = {};
    attempt.fullTest.questions.forEach((q, i) => {
        const subject = q.subject || 'Uncategorized';
        const topic = q.topic || 'General';
        if (!subjectStats[subject]) subjectStats[subject] = { correct: 0, total: 0, topics: {} };
        if (!subjectStats[subject].topics[topic]) subjectStats[subject].topics[topic] = { correct: 0, total: 0 };
        subjectStats[subject].total++;
        subjectStats[subject].topics[topic].total++;
        if (attempt.userAnswers[i] === q.answer) {
            subjectStats[subject].correct++;
            subjectStats[subject].topics[topic].correct++;
        }
    });

    for (const [subject, stats] of Object.entries(subjectStats)) {
        const subjectAccuracy = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
        reportContent += `${subject} (${subjectAccuracy.toFixed(1)}% Accuracy)\n`;
         for (const [topic, topicStats] of Object.entries(stats.topics)) {
             const topicAccuracy = topicStats.total > 0 ? (topicStats.correct / topicStats.total) * 100 : 0;
             reportContent += `  - ${topic}: ${topicStats.correct}/${topicStats.total} (${topicAccuracy.toFixed(0)}%)\n`;
         }
        reportContent += `\n`;
    }

    // All Questions Review
    reportContent += `--- All Questions Review ---\n\n`;
    attempt.fullTest.questions.forEach((q, index) => {
         const userAnswer = attempt.userAnswers[index];
         let userStatus = '';
         if (userAnswer === q.answer) userStatus = 'Correct';
         else if (userAnswer !== null) userStatus = 'Incorrect';
         else userStatus = 'Unanswered';

        reportContent += `Q${index + 1}: ${q.question} (${userStatus}) - Time: ${attempt.timePerQuestion[index].toFixed(1)}s\n`;
        q.options.forEach((opt, optIndex) => {
            let marker = '[ ]';
            if (optIndex === q.answer && optIndex === userAnswer) marker = '[✓]'; // Correctly answered
            else if (optIndex === q.answer) marker = '[✓]'; // Correct answer
            else if (optIndex === userAnswer) marker = '[✗]'; // User's incorrect answer
            
            reportContent += `  ${marker} ${opt}\n`;
        });
        reportContent += `Explanation: ${q.explanation}\n\n`;
    });
    
    const blob = new Blob([reportContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${attempt.testName.replace(/[^a-zA-Z0-9]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function renderTimeAnalysisCharts(attempt: TestAttempt) {
    // Question Time Chart with Toggle Button
    let perQuestionChartHTML = '<h4>Time Spent Per Question</h4><div class="chart-legend"><span class="legend-item"><span class="palette-indicator answered"></span> Correct</span><span class="legend-item"><span class="palette-indicator not-answered"></span> Incorrect</span><span class="legend-item"><span class="palette-indicator not-visited"></span> Unanswered</span></div>';
    
    perQuestionChartHTML += '<div id="q-chart-container" class="chart question-time-chart">';
    
    const maxTime = Math.max(...attempt.timePerQuestion, 1); // Use 1s minimum to avoid division by zero

    attempt.timePerQuestion.forEach((time, index) => {
        const q = attempt.fullTest.questions[index];
        const userAnswer = attempt.userAnswers[index];
        let statusClass = 'bar-unanswered';
        if (userAnswer === q.answer) {
            statusClass = 'bar-correct';
        } else if (userAnswer !== null) {
            statusClass = 'bar-incorrect';
        }
        
        const barWidth = (time / maxTime) * 100;

        perQuestionChartHTML += `
            <div class="chart-row">
                <div class="chart-label">Q${index + 1}</div>
                <div class="chart-bar-container">
                    <div class="chart-bar ${statusClass}" style="width: ${barWidth}%" title="Time: ${time.toFixed(1)}s"></div>
                </div>
                <div class="chart-value">${time.toFixed(1)}s</div>
            </div>
        `;
    });
    perQuestionChartHTML += '</div>';
    
    // Add the Expand Button
    perQuestionChartHTML += `<button id="expand-chart-btn" class="expand-chart-btn">Show Full Chart (All Questions)</button>`;

    // Subject Time Analysis
    const subjectTimes: { [key: string]: { totalTime: number; count: number } } = {};
    attempt.fullTest.questions.forEach((q, i) => {
        const subject = q.subject || 'Uncategorized';
        if (!subjectTimes[subject]) {
            subjectTimes[subject] = { totalTime: 0, count: 0 };
        }
        subjectTimes[subject].totalTime += attempt.timePerQuestion[i];
        subjectTimes[subject].count++;
    });

    const subjectAvgs = Object.entries(subjectTimes).map(([subject, data]) => ({
        subject,
        avgTime: data.totalTime / data.count,
    }));
    
    const maxAvgTime = Math.max(...subjectAvgs.map(s => s.avgTime), 1);
    
    let perSubjectChartHTML = '<br><br><h4>Average Time Per Subject</h4><div class="chart subject-time-chart">';
    subjectAvgs.forEach(({ subject, avgTime }) => {
        const barWidth = (avgTime / maxAvgTime) * 100;
        perSubjectChartHTML += `
            <div class="chart-row">
                <div class="chart-label">${subject}</div>
                <div class="chart-bar-container">
                    <div class="chart-bar" style="width: ${barWidth}%" title="Avg Time: ${avgTime.toFixed(1)}s"></div>
                </div>
                <div class="chart-value">${avgTime.toFixed(1)}s</div>
            </div>
        `;
    });
    perSubjectChartHTML += '</div>';

    timeAnalysisContainer.innerHTML = perQuestionChartHTML + perSubjectChartHTML;

    // Attach listener for Expand Button
    document.getElementById('expand-chart-btn')?.addEventListener('click', (e) => {
        const btn = e.target as HTMLElement;
        const chart = document.getElementById('q-chart-container');
        if (chart) {
            chart.classList.toggle('expanded');
            if (chart.classList.contains('expanded')) {
                btn.textContent = 'Collapse Chart';
            } else {
                btn.textContent = 'Show Full Chart (All Questions)';
            }
        }
    });
}


function renderSubjectBreakdown(attempt: TestAttempt) {
    const subjectStats: { [key: string]: { correct: number, total: number, topics: { [key: string]: { correct: number, total: number } } } } = {};
    
    attempt.fullTest.questions.forEach((q, i) => {
        const subject = q.subject || 'Uncategorized';
        const topic = q.topic || 'General';

        if (!subjectStats[subject]) {
            subjectStats[subject] = { correct: 0, total: 0, topics: {} };
        }
        if (!subjectStats[subject].topics[topic]) {
            subjectStats[subject].topics[topic] = { correct: 0, total: 0 };
        }

        subjectStats[subject].total++;
        subjectStats[subject].topics[topic].total++;

        if (attempt.userAnswers[i] === q.answer) {
            subjectStats[subject].correct++;
            subjectStats[subject].topics[topic].correct++;
        }
    });

    subjectBreakdownContainer.innerHTML = Object.entries(subjectStats).map(([subject, stats]) => {
        const accuracy = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
        return `
            <details class="subject-breakdown-item">
                <summary class="subject-header">
                    <h4>${subject}</h4>
                    <div class="subject-summary-stats">
                        <span class="subject-accuracy" style="--accuracy-color: ${accuracy > 60 ? 'var(--success-color)' : accuracy > 30 ? 'var(--warning-color)' : 'var(--danger-color)'}">${accuracy.toFixed(1)}%</span>
                        <span class="material-symbols-outlined expand-icon">expand_more</span>
                    </div>
                </summary>
                <div class="progress-bar">
                    <div class="progress-bar-fill" style="width: ${accuracy}%; background-color: ${accuracy > 60 ? 'var(--success-color)' : accuracy > 30 ? 'var(--warning-color)' : 'var(--danger-color)'};"></div>
                </div>
                <div class="topic-breakdown">
                    ${Object.entries(stats.topics).map(([topic, topicStats]) => {
                        const topicAccuracy = topicStats.total > 0 ? (topicStats.correct / topicStats.total) * 100 : 0;
                        return `
                            <div class="topic-breakdown-item">
                                <span>${topic}</span>
                                <span class="topic-stats">${topicStats.correct}/${topicStats.total} (${topicAccuracy.toFixed(0)}%)</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </details>
        `;
    }).join('');
}

function createQuestionReviewHTML(q: Question, index: number, attempt: TestAttempt): string {
    const userAnswer = attempt.userAnswers[index];
    let userStatus = 'Unanswered';
    let statusClass = 'unanswered';
    let isIncorrect = false;

    if (userAnswer === q.answer) {
        userStatus = 'Correct';
        statusClass = 'correct';
    } else if (userAnswer !== null) {
        userStatus = 'Incorrect';
        statusClass = 'incorrect';
        isIncorrect = true;
    }

    const optionsHTML = q.options.map((opt, optIndex) => {
        let li_class = 'detail-option-item';
        if (optIndex === q.answer) li_class += ' correct';
        if (optIndex === userAnswer && isIncorrect) li_class += ' user-incorrect';
        return `<li class="${li_class}">${opt}</li>`;
    }).join('');

    const analysisButtonHTML = isIncorrect ? `
        <button class="deeper-analysis-btn" data-question-index="${index}">
            <span class="material-symbols-outlined">psychology</span> Get Deeper AI Analysis
        </button>
    ` : '';

    return `
        <details class="results-detail-item status-${statusClass}">
            <summary class="question-summary-header">
                <div class="summary-left">
                    <span class="q-number">Q${index + 1}</span>
                    <span class="status-dot ${statusClass}"></span>
                    <span class="q-preview">${q.question}</span>
                </div>
                <div class="summary-right">
                    <span class="summary-meta">${q.subject}</span>
                    <span class="material-symbols-outlined expand-icon">expand_more</span>
                </div>
            </summary>
            <div class="question-content-body">
                <div class="question-header-full">
                     <span class="status-badge ${statusClass}">${userStatus}</span>
                     <span class="question-meta-full">${q.subject} > ${q.topic}</span>
                     <span class="time-spent-badge">Time: ${attempt.timePerQuestion[index].toFixed(1)}s</span>
                </div>
                <p class="question-text-full">${q.question}</p>
                <ul class="detail-options">${optionsHTML}</ul>
                <div class="explanation-box">
                    <h4>Explanation</h4>
                    <p>${q.explanation}</p>
                </div>
                <div class="deeper-analysis-controls">${analysisButtonHTML}</div>
                <div class="deeper-analysis-container hidden" data-analysis-for="${index}"></div>
            </div>
        </details>
    `;
}

function renderMistakesReview(attempt: TestAttempt) {
    const mistakesHTML = attempt.fullTest.questions
        .map((q, index) => {
            const userAnswer = attempt.userAnswers[index];
            const isMistake = userAnswer !== null && userAnswer !== q.answer;
            return isMistake ? createQuestionReviewHTML(q, index, attempt) : '';
        })
        .join('');

    if (!mistakesHTML) {
        mistakesReviewContainer.innerHTML = `<p class="placeholder">No incorrect answers to review. Great job!</p>`;
        return;
    }

    mistakesReviewContainer.innerHTML = mistakesHTML;
}

function renderAllQuestionsReview(attempt: TestAttempt) {
    allQuestionsReviewContainer.innerHTML = attempt.fullTest.questions
        .map((q, index) => createQuestionReviewHTML(q, index, attempt))
        .join('');
}


async function handleDeeperAnalysis(button: HTMLElement) {
    if (!ai || !currentAttemptForReport) return;

    const questionIndex = parseInt(button.dataset.questionIndex, 10);
    const question = currentAttemptForReport.fullTest.questions[questionIndex];
    const userAnswerIndex = currentAttemptForReport.userAnswers[questionIndex];

    if (userAnswerIndex === null) return; // Should not happen if button is only on incorrect answers

    const controlsContainer = button.parentElement;
    const analysisContainer = controlsContainer.nextElementSibling as HTMLElement;

    controlsContainer.innerHTML = `<div class="spinner-small"></div><span>Analyzing...</span>`;

    try {
        const userAnswerText = question.options[userAnswerIndex];
        const correctAnswerText = question.options[question.answer];
        const otherOptions = question.options.filter((_, i) => i !== question.answer && i !== userAnswerIndex);

        const prompt = `
            Analyze the following competitive exam (UPSC-style) question. The user incorrectly chose the option: "${userAnswerText}". The correct answer is: "${correctAnswerText}".
            
            Question: "${question.question}"

            Please provide a detailed analysis in a simple JSON format. The analysis should explain:
            1.  Why the user's selected answer ("${userAnswerText}") is incorrect.
            2.  A brief analysis of why each of the other incorrect options are also wrong.
            
            Do not explain why the correct answer is correct, as the user already has a separate explanation for that. Focus only on the incorrect options.
        `;

        const analysisSchema = {
            type: Type.OBJECT,
            properties: {
                userAnswerAnalysis: { 
                    type: Type.STRING, 
                    description: `A detailed explanation of why the user's choice, '${userAnswerText}', is incorrect.`
                },
                otherOptionsAnalysis: {
                    type: Type.ARRAY,
                    description: "An analysis of the other incorrect options.",
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            option: { type: Type.STRING, description: "The text of the incorrect option." },
                            reason: { type: Type.STRING, description: "The reason why this option is incorrect." }
                        },
                         required: ["option", "reason"]
                    }
                }
            },
            required: ["userAnswerAnalysis", "otherOptionsAnalysis"]
        };

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: analysisSchema,
            },
        });

        const result = JSON.parse(response.text);

        let analysisHTML = `
            <h4><span class="material-symbols-outlined">neurology</span> AI Deeper Analysis</h4>
            <div class="analysis-section">
                <h5>Analysis of Your Answer ("${userAnswerText}")</h5>
                <p>${result.userAnswerAnalysis}</p>
            </div>
        `;
        
        if (result.otherOptionsAnalysis && result.otherOptionsAnalysis.length > 0) {
             analysisHTML += `
                <div class="analysis-section">
                    <h5>Analysis of Other Options</h5>
                    <ul>
                        ${result.otherOptionsAnalysis.map(opt => `<li><strong>${opt.option}:</strong> ${opt.reason}</li>`).join('')}
                    </ul>
                </div>
             `;
        }

        analysisContainer.innerHTML = analysisHTML;
        analysisContainer.classList.remove('hidden');
        controlsContainer.classList.add('hidden'); // Hide the button/loader

    } catch (error) {
        console.error("Deeper Analysis Error:", error);
        analysisContainer.innerHTML = `<p class="error">Could not generate analysis. Please try again later.</p>`;
        analysisContainer.classList.remove('hidden');
        controlsContainer.innerHTML = ''; // Clear loader
        controlsContainer.appendChild(button); // Restore button
    }
}


// --- Analytics View Logic ---

// Type definitions for Analytics Aggregation
interface SubjectAnalytics {
    correct: number;
    total: number;
    totalTime: number; // in seconds
    topics: { [key: string]: { correct: number; total: number } };
}

// Global variable to store aggregated data for the modal
let aggregatedSubjectData: { [key: string]: SubjectAnalytics } = {};

function renderAnalyticsDashboard() {
    const history = getFromStorage<TestAttempt[]>('performanceHistory', []);
    
    if (history.length === 0) {
        analyticsStatsGrid.innerHTML = `<p class="placeholder" style="grid-column: 1/-1;">No data available. Complete some tests to see your analytics.</p>`;
        subjectMasteryContainer.innerHTML = '';
        // topicInsightsContainer has been removed from HTML, so no need to interact with it
        return;
    }

    // Reset Aggregation
    aggregatedSubjectData = {};
    let totalTests = history.length;
    let totalQuestions = 0;
    let totalCorrect = 0;
    let totalScoreSum = 0;
    let totalTimeTaken = 0;

    history.forEach(attempt => {
        totalQuestions += attempt.totalQuestions;
        totalCorrect += attempt.correctAnswers;
        totalScoreSum += attempt.score;
        totalTimeTaken += attempt.timeTaken;

        // Aggregate Subject and Topic Stats
        attempt.fullTest.questions.forEach((q, i) => {
            const subject = q.subject || 'Uncategorized';
            const topic = q.topic || 'General';
            
            // --- Subject Aggregation ---
            if (!aggregatedSubjectData[subject]) {
                aggregatedSubjectData[subject] = { correct: 0, total: 0, totalTime: 0, topics: {} };
            }
            aggregatedSubjectData[subject].total++;
            aggregatedSubjectData[subject].totalTime += attempt.timePerQuestion[i] || 0;
            
            // --- Topic Aggregation (Nested in Subject) ---
            if (!aggregatedSubjectData[subject].topics[topic]) {
                aggregatedSubjectData[subject].topics[topic] = { correct: 0, total: 0 };
            }
            aggregatedSubjectData[subject].topics[topic].total++;

            if (attempt.userAnswers[i] === q.answer) {
                aggregatedSubjectData[subject].correct++;
                aggregatedSubjectData[subject].topics[topic].correct++;
            }
        });
    });

    const avgScore = totalScoreSum / totalTests;
    const overallAccuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;
    const totalTimeHours = Math.floor(totalTimeTaken / 3600);
    const totalTimeMinutes = Math.floor((totalTimeTaken % 3600) / 60);

    // Render Stats Grid
    analyticsStatsGrid.innerHTML = `
        <div class="stat-card">
            <span class="material-symbols-outlined stat-icon">history</span>
            <div class="stat-value">${totalTests}</div>
            <div class="stat-label">Tests Taken</div>
        </div>
        <div class="stat-card">
            <span class="material-symbols-outlined stat-icon">percent</span>
            <div class="stat-value">${avgScore.toFixed(1)}%</div>
            <div class="stat-label">Avg. Score</div>
        </div>
        <div class="stat-card">
            <span class="material-symbols-outlined stat-icon">check_circle</span>
            <div class="stat-value">${overallAccuracy.toFixed(1)}%</div>
            <div class="stat-label">Overall Accuracy</div>
        </div>
        <div class="stat-card">
            <span class="material-symbols-outlined stat-icon">timer</span>
            <div class="stat-value">${totalTimeHours}h ${totalTimeMinutes}m</div>
            <div class="stat-label">Total Study Time</div>
        </div>
    `;

    // 2. Score Trend removed previously
    // 3. Topic Insights (Strongest/Weakest) removed as per request

    // 4. Render Subject Mastery Cards (Interactive)
    const sortedSubjects = Object.entries(aggregatedSubjectData)
        .map(([subject, stats]) => ({
            subject,
            accuracy: (stats.correct / stats.total) * 100,
            count: stats.total,
            stats: stats
        }))
        .sort((a, b) => b.accuracy - a.accuracy);

    subjectMasteryContainer.innerHTML = sortedSubjects.map(s => {
        const accuracyColor = s.accuracy > 60 ? 'var(--success-color)' : s.accuracy > 40 ? 'var(--warning-color)' : 'var(--danger-color)';
        return `
        <div class="subject-analytics-card" data-subject="${s.subject}">
            <div class="subject-card-header">
                <h4>${s.subject}</h4>
                <span class="material-symbols-outlined" style="opacity: 0.5;">chevron_right</span>
            </div>
            <div class="subject-card-stats">
                <div class="stat-row">
                    <span>Accuracy</span>
                    <span style="color: ${accuracyColor}; font-weight: bold;">${s.accuracy.toFixed(1)}%</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-bar-fill" style="width: ${s.accuracy}%; background-color: ${accuracyColor}"></div>
                </div>
                <div class="stat-mini">
                    <span>${s.count} Questions Attempted</span>
                </div>
            </div>
        </div>
    `}).join('');
}

// Add Event delegation for Subject Cards
subjectMasteryContainer.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest('.subject-analytics-card') as HTMLElement;
    if (card) {
        const subject = card.dataset.subject;
        openSubjectModal(subject);
    }
});

function openSubjectModal(subject: string) {
    const data = aggregatedSubjectData[subject];
    if (!data) return;

    modalSubjectTitle.textContent = `${subject} Analysis`;
    const accuracy = (data.correct / data.total) * 100;
    const avgTime = data.total > 0 ? (data.totalTime / data.total) : 0;
    const accuracyColor = accuracy > 60 ? 'var(--success-color)' : accuracy > 40 ? 'var(--warning-color)' : 'var(--danger-color)';

    // Sort topics by accuracy
    const sortedTopics = Object.entries(data.topics)
        .map(([topic, stats]) => ({
            topic,
            accuracy: (stats.correct / stats.total) * 100,
            correct: stats.correct,
            total: stats.total
        }))
        .sort((a, b) => b.accuracy - a.accuracy);

    modalBody.innerHTML = `
        <div class="modal-summary-grid">
            <div class="modal-stat-box">
                <span class="label">Overall Accuracy</span>
                <span class="value" style="color: ${accuracyColor}">${accuracy.toFixed(1)}%</span>
            </div>
            <div class="modal-stat-box">
                <span class="label">Total Questions</span>
                <span class="value">${data.total}</span>
            </div>
            <div class="modal-stat-box">
                <span class="label">Avg Time/Question</span>
                <span class="value">${avgTime.toFixed(1)}s</span>
            </div>
        </div>

        <h4 style="margin-top: 1.5rem; border-bottom: 1px solid var(--card-border-color); padding-bottom: 0.5rem;">Topic Performance</h4>
        <div class="topic-grid-container">
            ${sortedTopics.map(t => {
                const topicColor = t.accuracy > 60 ? 'var(--success-color)' : t.accuracy > 40 ? 'var(--warning-color)' : 'var(--danger-color)';
                return `
                <div class="topic-stat-card">
                    <div class="topic-header">
                        <span class="topic-name">${t.topic}</span>
                        <span class="topic-score" style="color: ${topicColor}">${t.accuracy.toFixed(0)}%</span>
                    </div>
                    <div class="progress-bar small">
                        <div class="progress-bar-fill" style="width: ${t.accuracy}%; background-color: ${topicColor}"></div>
                    </div>
                    <div class="topic-details">
                        ${t.correct}/${t.total} Correct
                    </div>
                </div>
            `}).join('')}
        </div>
    `;

    analyticsModal.classList.remove('hidden');
}