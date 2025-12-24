import { GoogleGenAI, Type } from "@google/genai";
import * as pdfjsLib from 'pdfjs-dist';

// --- Type Definitions ---
interface User {
    username: string;
    password: string;
    name: string;
    createdAt: string;
}

interface Question {
    question: string;
    options: string[];
    answer: number;
    explanation: string;
    subject: string;
    topic: string;
}

interface Test {
    id: string;
    name: string;
    questions: Question[];
    duration: number;
    language: string;
    createdAt: string;
    marksPerQuestion: number;
    negativeMarking: number;
}

interface TestAttempt {
    testId: string;
    testName: string;
    userAnswers: (number | null)[];
    timeTaken: number;
    timePerQuestion: number[];
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
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.4.168/build/pdf.worker.mjs`;

// --- Current User State ---
let currentUser: User | null = null;

// --- Gemini AI ---
let ai: GoogleGenAI;
try {
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
} catch (e) {
    console.error("Failed to initialize GoogleGenAI", e);
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
        console.error(`Error reading from localStorage key "${key}":`, error);
        return defaultValue;
    }
}

function saveToStorage<T>(key: string, value: T): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.error(`Error writing to localStorage key "${key}":`, error);
    }
}

// --- Toast Notifications ---
function showToast(message: string, type: 'success' | 'error' | 'warning' = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="material-symbols-rounded">${type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'warning'}</span>
        <span class="toast-message">${message}</span>
        <button class="toast-close"><span class="material-symbols-rounded">close</span></button>
    `;

    container.appendChild(toast);

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn?.addEventListener('click', () => toast.remove());

    setTimeout(() => toast.remove(), 4000);
}

// --- Authentication Functions ---
function hashPassword(password: string): string {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        const char = password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}

function getUsers(): User[] {
    try {
        const users = localStorage.getItem('registeredUsers');
        return users ? JSON.parse(users) : [];
    } catch {
        return [];
    }
}

function saveUsers(users: User[]): void {
    localStorage.setItem('registeredUsers', JSON.stringify(users));
}

function registerUser(name: string, username: string, password: string): { success: boolean; message: string } {
    const users = getUsers();
    
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
        return { success: false, message: 'Username already exists!' };
    }
    
    if (username.length < 3) {
        return { success: false, message: 'Username must be at least 3 characters!' };
    }
    
    if (password.length < 4) {
        return { success: false, message: 'Password must be at least 4 characters!' };
    }
    
    const newUser: User = {
        username: username.toLowerCase(),
        password: hashPassword(password),
        name: name,
        createdAt: new Date().toISOString()
    };
    
    users.push(newUser);
    saveUsers(users);
    
    return { success: true, message: 'Account created successfully!' };
}

function authenticateUser(username: string, password: string): { success: boolean; user?: User; message: string } {
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    
    if (!user) {
        return { success: false, message: 'Invalid username or password!' };
    }
    
    if (user.password !== hashPassword(password)) {
        return { success: false, message: 'Invalid username or password!' };
    }
    
    return { success: true, user, message: 'Login successful!' };
}

// --- DOM Elements ---
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const registerForm = document.getElementById('register-form') as HTMLFormElement;
const loginUsernameInput = document.getElementById('login-username') as HTMLInputElement;
const loginPasswordInput = document.getElementById('login-password') as HTMLInputElement;
const rememberMeCheckbox = document.getElementById('remember-me') as HTMLInputElement;
const showRegisterBtn = document.getElementById('show-register-btn');
const backToLoginBtn = document.getElementById('back-to-login-btn');
const registerNameInput = document.getElementById('register-name') as HTMLInputElement;
const registerUsernameInput = document.getElementById('register-username') as HTMLInputElement;
const registerPasswordInput = document.getElementById('register-password') as HTMLInputElement;
const registerConfirmInput = document.getElementById('register-confirm') as HTMLInputElement;
const logoutBtn = document.getElementById('logout-btn');
const userDisplayName = document.getElementById('user-display-name');
const dropdownUsername = document.getElementById('dropdown-username');
const userMenuBtn = document.getElementById('user-menu-btn');
const userDropdown = document.getElementById('user-dropdown');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const backupDataBtn = document.getElementById('backup-data-btn');
const restoreDataBtn = document.getElementById('restore-data-btn');
const restoreFileInput = document.getElementById('restore-file-input') as HTMLInputElement;

// View Sections
const dashboardView = document.getElementById('dashboard-view');
const createTestView = document.getElementById('create-test-view');
const editTestView = document.getElementById('edit-test-view');
const allTestsView = document.getElementById('all-tests-view');
const testDetailView = document.getElementById('test-detail-view');
const testAttemptView = document.getElementById('test-attempt-view');
const performanceView = document.getElementById('performance-view');
const performanceReportView = document.getElementById('performance-report-view');
const analyticsView = document.getElementById('analytics-view');
const bookmarksView = document.getElementById('bookmarks-view');

// Dashboard Elements
const welcomeName = document.getElementById('welcome-name');
const streakCount = document.getElementById('streak-count');
const totalTestsEl = document.getElementById('total-tests');
const totalQuestionsEl = document.getElementById('total-questions');
const avgAccuracyEl = document.getElementById('avg-accuracy');
const studyTimeEl = document.getElementById('study-time');
const recentTestsContainer = document.getElementById('recent-tests-container');
const viewAllTestsBtn = document.getElementById('view-all-tests-btn');

// Create Test View Elements
const sourceTabs = document.querySelectorAll('.source-tab');
const tabContents = document.querySelectorAll('.tab-content');
let activeSourceTab = 'topic';
const topicInput = document.getElementById('topic-input') as HTMLInputElement;
const textInput = document.getElementById('text-input') as HTMLTextAreaElement;
const fileUpload = document.getElementById('file-upload') as HTMLInputElement;
const fileDropZone = document.getElementById('file-drop-zone');
const selectedFileName = document.getElementById('selected-file-name');
const manualInput = document.getElementById('manual-input') as HTMLTextAreaElement;
const testNameInput = document.getElementById('test-name-input') as HTMLInputElement;
const questionsSlider = document.getElementById('questions-slider') as HTMLInputElement;
const questionsCount = document.getElementById('questions-count');
const durationInput = document.getElementById('duration-input') as HTMLInputElement;
const languageSelect = document.getElementById('language-select') as HTMLSelectElement;
const marksInput = document.getElementById('marks-input') as HTMLInputElement;
const negativeInput = document.getElementById('negative-input') as HTMLSelectElement;
const generateTestBtn = document.getElementById('generate-test-btn') as HTMLButtonElement;
const loader = document.getElementById('loader');

// Edit Test View Elements
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
const startTestBtn = document.getElementById('start-test-btn');
const editTestDetailBtn = document.getElementById('edit-test-detail-btn');
const deleteTestBtn = document.getElementById('delete-test-btn');

// Test Attempt View Elements
const attemptTestTitle = document.getElementById('attempt-test-title');
const timeLeftEl = document.getElementById('time-left');
const currentQNum = document.getElementById('current-q-num');
const totalQNum = document.getElementById('total-q-num');
const questionContentContainer = document.getElementById('question-content');
const questionPaletteContainer = document.getElementById('question-palette');
const prevQuestionBtn = document.getElementById('prev-question-btn');
const saveNextBtn = document.getElementById('save-next-btn') as HTMLButtonElement;
const markReviewBtn = document.getElementById('mark-review-btn') as HTMLButtonElement;
const clearResponseBtn = document.getElementById('clear-response-btn') as HTMLButtonElement;
const submitTestBtn = document.getElementById('submit-test-btn');
const abandonTestBtn = document.getElementById('abandon-test-btn');
const togglePaletteBtn = document.getElementById('toggle-palette-btn');
const palettePanel = document.querySelector('.palette-panel');

// Performance View Elements
const performanceContainer = document.getElementById('performance-container');
const performanceReportTitle = document.getElementById('performance-report-title');
const performanceSummaryContainer = document.getElementById('performance-summary-container');
const backToPerformanceListBtn = document.getElementById('back-to-performance-list');
const downloadReportBtn = document.getElementById('download-report-btn');
const mistakesReviewContainer = document.getElementById('mistakes-view');
const allQuestionsReviewContainer = document.getElementById('all-questions-view');
const subjectBreakdownContainer = document.getElementById('subject-breakdown-view');
const timeAnalysisContainer = document.getElementById('time-analysis-view');

// Analytics View Elements
const analyticsStatsGrid = document.getElementById('analytics-stats-grid');
const subjectMasteryContainer = document.getElementById('subject-mastery-container');
const analyticsModal = document.getElementById('analytics-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const modalSubjectTitle = document.getElementById('modal-subject-title');
const modalBody = document.getElementById('modal-body');

// Bookmarks View Elements
const bookmarksContainer = document.getElementById('bookmarks-container');

// Bottom Navigation
const bottomNav = document.querySelector('.bottom-nav');
const fabCreate = document.getElementById('fab-create');

// --- Test State ---
let currentTest: Test | null = null;
let currentQuestionIndex = 0;
let userAnswers: (number | null)[] = [];
let questionStatuses: QuestionStatus[] = [];
let timerInterval: number | null = null;
let timeRemaining = 0;
let timePerQuestion: number[] = [];
let questionStartTime = 0;
let currentAttemptForReport: TestAttempt | null = null;
let reportReturnView: HTMLElement = performanceView;

// Analytics Aggregation
interface SubjectAnalytics {
    correct: number;
    total: number;
    totalTime: number;
    topics: { [key: string]: { correct: number; total: number } };
}
let aggregatedSubjectData: { [key: string]: SubjectAnalytics } = {};

// --- View Management ---
const views = [dashboardView, createTestView, editTestView, allTestsView, testDetailView, testAttemptView, performanceView, performanceReportView, analyticsView, bookmarksView];

function showView(viewToShow: HTMLElement) {
    views.forEach(view => {
        if (view === viewToShow) {
            view?.classList.remove('hidden');
        } else {
            view?.classList.add('hidden');
        }
    });
    
    // Update bottom nav active state
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active'));
    
    if (viewToShow === dashboardView) {
        document.querySelector('.nav-item[data-nav="dashboard"]')?.classList.add('active');
    } else if (viewToShow === allTestsView) {
        document.querySelector('.nav-item[data-nav="all-tests"]')?.classList.add('active');
    } else if (viewToShow === createTestView) {
        document.querySelector('.nav-item[data-nav="create"]')?.classList.add('active');
    } else if (viewToShow === performanceView || viewToShow === performanceReportView) {
        document.querySelector('.nav-item[data-nav="performance"]')?.classList.add('active');
    } else if (viewToShow === analyticsView) {
        document.querySelector('.nav-item[data-nav="analytics"]')?.classList.add('active');
    }
    
    // Show/hide bottom nav based on view
    if (viewToShow === testAttemptView) {
        bottomNav?.classList.add('hidden');
        fabCreate?.classList.remove('hidden');
    } else {
        bottomNav?.classList.remove('hidden');
        fabCreate?.classList.add('hidden');
    }
    
    window.scrollTo(0, 0);
}

// --- Authentication ---
function loginUser(user: User, remember: boolean): void {
    currentUser = user;
    
    if (remember) {
        localStorage.setItem('rememberedUser', JSON.stringify({ username: user.username, name: user.name }));
    } else {
        localStorage.removeItem('rememberedUser');
    }
    
    sessionStorage.setItem('currentUser', JSON.stringify(user));
    
    if (userDisplayName) userDisplayName.textContent = user.name;
    if (dropdownUsername) dropdownUsername.textContent = user.name;
    if (welcomeName) welcomeName.textContent = user.name;
    
    loginScreen?.classList.add('hidden');
    appContainer?.classList.remove('hidden');
    
    updateDashboardStats();
    renderRecentTests();
}

function logoutUser(): void {
    currentUser = null;
    sessionStorage.removeItem('currentUser');
    
    appContainer?.classList.add('hidden');
    loginScreen?.classList.remove('hidden');
    
    loginForm?.reset();
    registerForm?.reset();
    showLoginForm();
}

function checkExistingSession(): void {
    const sessionUser = sessionStorage.getItem('currentUser');
    if (sessionUser) {
        try {
            const user = JSON.parse(sessionUser);
            currentUser = user;
            if (userDisplayName) userDisplayName.textContent = user.name;
            if (dropdownUsername) dropdownUsername.textContent = user.name;
            if (welcomeName) welcomeName.textContent = user.name;
            loginScreen?.classList.add('hidden');
            appContainer?.classList.remove('hidden');
            updateDashboardStats();
            renderRecentTests();
            return;
        } catch {}
    }
    
    const remembered = localStorage.getItem('rememberedUser');
    if (remembered) {
        try {
            const { username } = JSON.parse(remembered);
            if (loginUsernameInput) loginUsernameInput.value = username;
            if (rememberMeCheckbox) rememberMeCheckbox.checked = true;
        } catch {}
    }
}

function showLoginForm(): void {
    loginForm?.classList.remove('hidden');
    registerForm?.classList.add('hidden');
}

function showRegisterForm(): void {
    loginForm?.classList.add('hidden');
    registerForm?.classList.remove('hidden');
}

// --- Authentication Event Listeners ---
loginForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const username = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value;
    const remember = rememberMeCheckbox.checked;
    
    const result = authenticateUser(username, password);
    
    if (result.success && result.user) {
        loginUser(result.user, remember);
        showToast('Welcome back!', 'success');
    } else {
        showToast(result.message, 'error');
    }
});

registerForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const name = registerNameInput.value.trim();
    const username = registerUsernameInput.value.trim();
    const password = registerPasswordInput.value;
    const confirm = registerConfirmInput.value;
    
    if (password !== confirm) {
        showToast('Passwords do not match!', 'error');
        return;
    }
    
    const result = registerUser(name, username, password);
    
    if (result.success) {
        showToast(result.message, 'success');
        const authResult = authenticateUser(username, password);
        if (authResult.success && authResult.user) {
            loginUser(authResult.user, false);
        } else {
            showLoginForm();
        }
    } else {
        showToast(result.message, 'error');
    }
});

showRegisterBtn?.addEventListener('click', showRegisterForm);
backToLoginBtn?.addEventListener('click', showLoginForm);
logoutBtn?.addEventListener('click', () => {
    if (confirm('Are you sure you want to logout?')) {
        logoutUser();
    }
});

// --- User Menu Dropdown ---
userMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdown?.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
    if (!userDropdown?.contains(e.target as Node) && e.target !== userMenuBtn) {
        userDropdown?.classList.add('hidden');
    }
});

// --- Backup & Restore ---
backupDataBtn?.addEventListener('click', () => {
    const data = {
        tests: getFromStorage<Test[]>('tests', []),
        performanceHistory: getFromStorage<TestAttempt[]>('performanceHistory', []),
        bookmarks: getFromStorage<any[]>('bookmarks', []),
        exportedAt: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `upsc-prep-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('Backup downloaded successfully!', 'success');
    userDropdown?.classList.add('hidden');
});

restoreDataBtn?.addEventListener('click', () => {
    restoreFileInput?.click();
    userDropdown?.classList.add('hidden');
});

restoreFileInput?.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const text = e.target?.result as string;
            const data = JSON.parse(text);
            
            if (confirm("This will merge the backup with your current data. Continue?")) {
                const currentTests = getFromStorage<Test[]>('tests', []);
                const currentHistory = getFromStorage<TestAttempt[]>('performanceHistory', []);
                
                const newTests = Array.isArray(data.tests) ? [...data.tests, ...currentTests] : currentTests;
                const newHistory = Array.isArray(data.performanceHistory) ? [...data.performanceHistory, ...currentHistory] : currentHistory;
                
                const uniqueTests = Array.from(new Map(newTests.map(item => [item.id, item])).values());
                
                saveToStorage('tests', uniqueTests);
                saveToStorage('performanceHistory', newHistory);
                
                showToast('Data restored successfully!', 'success');
                updateDashboardStats();
                renderRecentTests();
            }
        } catch (error) {
            showToast('Failed to restore data. Invalid file format.', 'error');
        } finally {
            input.value = '';
        }
    };
    reader.readAsText(file);
});

// --- Dashboard Stats ---
function updateDashboardStats() {
    const history = getFromStorage<TestAttempt[]>('performanceHistory', []);
    const tests = getFromStorage<Test[]>('tests', []);
    
    let totalQuestions = 0;
    let totalCorrect = 0;
    let totalTime = 0;
    
    history.forEach(attempt => {
        totalQuestions += attempt.totalQuestions;
        totalCorrect += attempt.correctAnswers;
        totalTime += attempt.timeTaken;
    });
    
    const avgAccuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;
    const hours = Math.floor(totalTime / 3600);
    const minutes = Math.floor((totalTime % 3600) / 60);
    
    if (totalTestsEl) totalTestsEl.textContent = history.length.toString();
    if (totalQuestionsEl) totalQuestionsEl.textContent = totalQuestions.toString();
    if (avgAccuracyEl) avgAccuracyEl.textContent = `${avgAccuracy.toFixed(0)}%`;
    if (studyTimeEl) studyTimeEl.textContent = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    
    // Calculate streak
    const streak = calculateStreak(history);
    if (streakCount) streakCount.textContent = streak.toString();
}

function calculateStreak(history: TestAttempt[]): number {
    if (history.length === 0) return 0;
    
    const dates = history.map(h => new Date(h.completedAt).toDateString());
    const uniqueDates = [...new Set(dates)].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    
    let streak = 0;
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    
    if (uniqueDates[0] === today || uniqueDates[0] === yesterday) {
        streak = 1;
        for (let i = 1; i < uniqueDates.length; i++) {
            const prev = new Date(uniqueDates[i - 1]);
            const curr = new Date(uniqueDates[i]);
            const diff = (prev.getTime() - curr.getTime()) / 86400000;
            if (diff === 1) {
                streak++;
            } else {
                break;
            }
        }
    }
    
    return streak;
}

function renderRecentTests() {
    const history = getFromStorage<TestAttempt[]>('performanceHistory', []);
    
    if (history.length === 0) {
        if (recentTestsContainer) {
            recentTestsContainer.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-rounded">inbox</span>
                    <p>No tests yet. Create your first test!</p>
                </div>
            `;
        }
        return;
    }
    
    const recent = history.slice(0, 3);
    if (recentTestsContainer) {
        recentTestsContainer.innerHTML = recent.map((attempt, index) => {
            const date = new Date(attempt.completedAt).toLocaleDateString();
            const scoreClass = attempt.score >= 50 ? 'pass' : 'fail';
            return `
                <div class="performance-card" data-attempt-index="${index}">
                    <div>
                        <h3>${attempt.testName}</h3>
                        <div class="performance-meta">
                            <span><span class="material-symbols-rounded">calendar_today</span> ${date}</span>
                            <span><span class="material-symbols-rounded">quiz</span> ${attempt.totalQuestions} Q</span>
                        </div>
                    </div>
                    <div class="score-badge ${scoreClass}">${attempt.score.toFixed(0)}%</div>
                </div>
            `;
        }).join('');
    }
}

// --- Navigation Event Listeners ---
// Bottom Nav
bottomNav?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const navItem = target.closest('.nav-item') as HTMLElement;
    if (!navItem) return;
    
    const nav = navItem.dataset.nav;
    switch (nav) {
        case 'dashboard':
            updateDashboardStats();
            renderRecentTests();
            showView(dashboardView);
            break;
        case 'all-tests':
            renderAllTests();
            showView(allTestsView);
            break;
        case 'create':
            showView(createTestView);
            break;
        case 'performance':
            renderPerformanceHistory();
            showView(performanceView);
            break;
        case 'analytics':
            renderAnalyticsDashboard();
            showView(analyticsView);
            break;
    }
});

// Dashboard Quick Actions
document.querySelector('.action-cards')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest('.action-card') as HTMLElement;
    if (!card) return;
    
    const action = card.dataset.action;
    switch (action) {
        case 'create':
            showView(createTestView);
            break;
        case 'practice':
            renderAllTests();
            showView(allTestsView);
            break;
        case 'review':
            renderPerformanceHistory();
            showView(performanceView);
            break;
    }
});

// Dashboard Feature Cards
document.querySelector('.feature-grid')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest('.feature-card') as HTMLElement;
    if (!card) return;
    
    const feature = card.dataset.feature;
    switch (feature) {
        case 'all-tests':
            renderAllTests();
            showView(allTestsView);
            break;
        case 'performance':
            renderPerformanceHistory();
            showView(performanceView);
            break;
        case 'analytics':
            renderAnalyticsDashboard();
            showView(analyticsView);
            break;
        case 'bookmarks':
            renderBookmarks();
            showView(bookmarksView);
            break;
    }
});

viewAllTestsBtn?.addEventListener('click', () => {
    renderAllTests();
    showView(allTestsView);
});

recentTestsContainer?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest('.performance-card') as HTMLElement;
    if (!card) return;
    
    const index = parseInt(card.dataset.attemptIndex || '0', 10);
    const history = getFromStorage<TestAttempt[]>('performanceHistory', []);
    if (history[index]) {
        renderPerformanceReport(history[index], true);
        showView(performanceReportView);
    }
});

// Back Buttons
document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const backTo = (btn as HTMLElement).dataset.back;
        switch (backTo) {
            case 'dashboard':
                updateDashboardStats();
                renderRecentTests();
                showView(dashboardView);
                break;
            case 'create':
                showView(createTestView);
                break;
            case 'all-tests':
                renderAllTests();
                showView(allTestsView);
                break;
        }
    });
});

backToPerformanceListBtn?.addEventListener('click', () => {
    if (reportReturnView === performanceView) {
        renderPerformanceHistory();
        showView(performanceView);
    } else {
        renderAllTests();
        showView(allTestsView);
    }
});

// FAB
fabCreate?.addEventListener('click', () => {
    showView(createTestView);
});

// --- Create Test Logic ---
sourceTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        sourceTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        const tabName = (tab as HTMLElement).dataset.tab;
        activeSourceTab = tabName || 'topic';
        
        tabContents.forEach(content => {
            if (content.id === `tab-${tabName}`) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });
    });
});

questionsSlider?.addEventListener('input', () => {
    if (questionsCount) questionsCount.textContent = questionsSlider.value;
});

// File Upload
fileDropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileDropZone.classList.add('drag-over');
});

fileDropZone?.addEventListener('dragleave', () => {
    fileDropZone?.classList.remove('drag-over');
});

fileDropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    fileDropZone?.classList.remove('drag-over');
    const files = (e as DragEvent).dataTransfer?.files;
    if (files && files[0]) {
        handleFileSelect(files[0]);
    }
});

fileUpload?.addEventListener('change', () => {
    if (fileUpload.files?.[0]) {
        handleFileSelect(fileUpload.files[0]);
    }
});

function handleFileSelect(file: File) {
    if (selectedFileName) {
        selectedFileName.textContent = file.name;
    }
}

generateTestBtn?.addEventListener('click', handleGenerateTest);

async function handleGenerateTest() {
    if (!ai) {
        showToast("AI Service is not available. Please check your API key.", 'error');
        return;
    }

    loader?.classList.remove('hidden');
    if (generateTestBtn) generateTestBtn.disabled = true;

    let source = "Custom Input";
    let contentsForApi;

    const numQuestions = parseInt(questionsSlider?.value || '25', 10);
    const language = languageSelect?.value || 'English';
    const testName = testNameInput?.value.trim() || '';
    const marks = parseFloat(marksInput?.value || '2') || 2;
    const negative = parseFloat(negativeInput?.value || '0.66') || 0.66;

    try {
        switch (activeSourceTab) {
            case 'topic':
                const topic = topicInput?.value.trim();
                if (!topic) throw new Error('Please enter a topic.');
                source = topic;
                contentsForApi = `Generate ${numQuestions} UPSC-style multiple-choice questions (4 options) based on the following topic: ${topic}. The questions should be in ${language}. For each question, provide the question, four options, the 0-indexed correct answer, a detailed explanation, the general subject, and the specific topic.`;
                break;
            case 'text':
                const text = textInput?.value.trim();
                if (!text) throw new Error('Please paste some text.');
                source = "Pasted Text";
                contentsForApi = `Generate ${numQuestions} UPSC-style multiple-choice questions (4 options) based on the following text: """${text}""". The questions should be in ${language}. For each question, provide the question, four options, the 0-indexed correct answer, a detailed explanation, the general subject, and the specific topic.`;
                break;
            case 'manual':
                const manualText = manualInput?.value.trim();
                if (!manualText) throw new Error('Please paste your questions in the text area.');
                source = "Bulk Import";
                contentsForApi = `Analyze the following text and extract ALL multiple-choice questions found within it.
                
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
                break;
            case 'file':
                const file = fileUpload?.files?.[0];
                if (!file) throw new Error('Please select a file to upload.');
                source = file.name;

                if (file.type === "text/plain" || file.name.toLowerCase().endsWith('.txt')) {
                    const fileText = await file.text();
                    if (!fileText.trim()) throw new Error('The uploaded file is empty.');
                    contentsForApi = `Generate ${numQuestions} UPSC-style multiple-choice questions (4 options) based on the following text. The questions should be in ${language}. For each question, provide the question, four options, the 0-indexed correct answer, a detailed explanation, the general subject, and the specific topic.\n\nText: """${fileText}"""`;
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

                    if (fullText.trim().length > 100) {
                        contentsForApi = `Generate ${numQuestions} UPSC-style multiple-choice questions (4 options) based on the following text. The questions should be in ${language}. For each question, provide the question, four options, the 0-indexed correct answer, a detailed explanation, the general subject, and the specific topic.\n\nText: """${fullText}"""`;
                    } else {
                        throw new Error('Could not extract sufficient text from the PDF. Please try a text-based PDF or TXT file.');
                    }
                } else {
                    throw new Error(`Unsupported file type. Please upload a PDF or TXT file.`);
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
            throw new Error("AI did not return a valid response.");
        }

        const parsedResponse = JSON.parse(response.text);

        if (!Array.isArray(parsedResponse) || parsedResponse.length === 0) {
            throw new Error("Invalid response format from AI.");
        }

        currentTest = {
            id: `test_${Date.now()}`,
            name: testName || `Test on ${source}`,
            questions: parsedResponse,
            duration: parseInt(durationInput?.value || '30', 10),
            language: language,
            createdAt: new Date().toISOString(),
            marksPerQuestion: marks,
            negativeMarking: negative
        };

        renderEditableTest(currentTest);
        showView(editTestView);
        showToast(`Generated ${parsedResponse.length} questions!`, 'success');
    } catch (error: any) {
        console.error("Error generating test:", error);
        showToast(`Failed to generate test. ${error.message}`, 'error');
    } finally {
        loader?.classList.add('hidden');
        if (generateTestBtn) generateTestBtn.disabled = false;
    }
}

// --- Edit Test Logic ---
function renderEditableTest(test: Test) {
    const titleEl = editTestView?.querySelector('.view-header h1');
    if (titleEl) titleEl.textContent = `Review & Edit: ${test.name}`;
    
    if (editableQuestionsContainer) {
        editableQuestionsContainer.innerHTML = test.questions.map((q, index) => `
            <div class="editable-question-item" data-question-index="${index}" id="eq-${index}">
                <div class="editable-question-header">
                    <h4>Question ${index + 1}</h4>
                    <div class="editable-question-actions">
                        <button class="icon-btn delete-q" title="Delete Question">
                            <span class="material-symbols-rounded">delete</span>
                        </button>
                        <button class="icon-btn toggle-q" title="Expand/Collapse">
                            <span class="material-symbols-rounded">expand_more</span>
                        </button>
                    </div>
                </div>
                
                <div class="editable-question-body hidden">
                    <div class="input-group">
                        <label for="q-text-${index}">Question Text</label>
                        <textarea id="q-text-${index}" class="input-field textarea-large">${q.question}</textarea>
                    </div>
                    
                    <div class="input-group">
                        <label>Options (Select Correct Answer)</label>
                        <div class="options-editor">
                            ${q.options.map((opt, optIndex) => `
                                <div class="option-item">
                                    <input type="radio" name="q-answer-${index}" value="${optIndex}" ${q.answer === optIndex ? 'checked' : ''}>
                                    <input type="text" class="input-field" value="${opt}" placeholder="Option ${optIndex + 1}">
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    
                    <div class="meta-grid">
                        <div class="input-group">
                            <label for="q-subject-${index}">Subject</label>
                            <input type="text" id="q-subject-${index}" class="input-field" value="${q.subject}">
                        </div>
                        <div class="input-group">
                            <label for="q-topic-${index}">Topic</label>
                            <input type="text" id="q-topic-${index}" class="input-field" value="${q.topic}">
                        </div>
                    </div>
                    
                    <div class="input-group">
                        <label for="q-exp-${index}">Explanation</label>
                        <textarea id="q-exp-${index}" class="input-field textarea-large">${q.explanation}</textarea>
                    </div>
                </div>
            </div>
        `).join('');

        // Open first question by default
        const firstItem = document.getElementById('eq-0');
        if (firstItem) {
            firstItem.setAttribute('open', '');
            firstItem.querySelector('.editable-question-body')?.classList.remove('hidden');
            const icon = firstItem.querySelector('.toggle-q span');
            if (icon) icon.textContent = 'expand_less';
        }
    }
}

editableQuestionsContainer?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    
    const deleteBtn = target.closest('.delete-q');
    if (deleteBtn) {
        e.stopPropagation();
        const item = deleteBtn.closest('.editable-question-item') as HTMLElement;
        const index = parseInt(item.dataset.questionIndex || '0', 10);
        if (confirm(`Are you sure you want to delete question ${index + 1}?`)) {
            syncCurrentTestFromDOM();
            currentTest?.questions.splice(index, 1);
            if (currentTest) renderEditableTest(currentTest);
        }
        return;
    }

    const header = target.closest('.editable-question-header');
    const toggleBtn = target.closest('.toggle-q');
    
    if (header || toggleBtn) {
        if (target.closest('.delete-q')) return;

        const item = target.closest('.editable-question-item') as HTMLElement;
        const isOpen = item.hasAttribute('open');
        const body = item.querySelector('.editable-question-body');
        const icon = item.querySelector('.toggle-q span');
        
        if (isOpen) {
            item.removeAttribute('open');
            body?.classList.add('hidden');
            if (icon) icon.textContent = 'expand_more';
        } else {
            item.setAttribute('open', '');
            body?.classList.remove('hidden');
            if (icon) icon.textContent = 'expand_less';
        }
    }
});

function syncCurrentTestFromDOM() {
    if (!currentTest || !editableQuestionsContainer) return;
    const questionForms = editableQuestionsContainer.querySelectorAll('.editable-question-item');
    const updatedQuestions: Question[] = [];

    questionForms.forEach((form, index) => {
        const questionText = (form.querySelector(`#q-text-${index}`) as HTMLTextAreaElement)?.value || '';
        const explanationText = (form.querySelector(`#q-exp-${index}`) as HTMLTextAreaElement)?.value || '';
        const subjectText = (form.querySelector(`#q-subject-${index}`) as HTMLInputElement)?.value || '';
        const topicText = (form.querySelector(`#q-topic-${index}`) as HTMLInputElement)?.value || '';
        const answer = parseInt((form.querySelector(`input[name="q-answer-${index}"]:checked`) as HTMLInputElement)?.value || '0');
        
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

addQuestionBtn?.addEventListener('click', () => {
    if (!currentTest) return;
    syncCurrentTestFromDOM();
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
    
    const lastIdx = currentTest.questions.length - 1;
    setTimeout(() => {
        const newItem = document.getElementById(`eq-${lastIdx}`);
        if (newItem) {
            newItem.setAttribute('open', '');
            newItem.querySelector('.editable-question-body')?.classList.remove('hidden');
            const icon = newItem.querySelector('.toggle-q span');
            if (icon) icon.textContent = 'expand_less';
            newItem.scrollIntoView({ behavior: 'smooth' });
        }
    }, 100);
});

saveTestBtn?.addEventListener('click', () => {
    if (!currentTest) return;
    syncCurrentTestFromDOM();

    const tests = getFromStorage<Test[]>('tests', []);
    const existingIndex = tests.findIndex(t => t.id === currentTest?.id);
    
    if (existingIndex > -1) {
        tests[existingIndex] = currentTest;
        showToast('Test updated successfully!', 'success');
    } else {
        tests.unshift(currentTest);
        showToast('Test created successfully!', 'success');
    }
    
    saveToStorage('tests', tests);
    renderAllTests();
    showView(allTestsView);
});

// --- All Tests Logic ---
function renderAllTests() {
    const tests = getFromStorage<Test[]>('tests', []);
    
    if (tests.length === 0) {
        if (allTestsContainer) {
            allTestsContainer.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-rounded">folder_open</span>
                    <h3>No Tests Yet</h3>
                    <p>Create your first test to get started</p>
                    <button class="btn-primary" data-action="create">
                        <span class="material-symbols-rounded">add</span>
                        Create Test
                    </button>
                </div>
            `;
        }
        return;
    }
    
    if (allTestsContainer) {
        allTestsContainer.innerHTML = tests.map(test => {
            const date = new Date(test.createdAt).toLocaleDateString();
            return `
                <div class="test-item" data-testid="${test.id}">
                    <div>
                        <h3>${test.name}</h3>
                        <p>Created on ${date}</p>
                    </div>
                    <div class="test-meta">
                        <span class="meta-tag">
                            <span class="material-symbols-rounded">quiz</span>
                            ${test.questions.length} Questions
                        </span>
                        <span class="meta-tag">
                            <span class="material-symbols-rounded">timer</span>
                            ${test.duration} mins
                        </span>
                    </div>
                    <div class="test-actions">
                        <button class="btn-primary btn-sm start-btn">
                            <span class="material-symbols-rounded">play_arrow</span>
                            Start
                        </button>
                        <button class="btn-secondary btn-sm edit-btn">
                            <span class="material-symbols-rounded">edit</span>
                        </button>
                        <button class="btn-secondary btn-sm download-btn">
                            <span class="material-symbols-rounded">download</span>
                        </button>
                        <button class="btn-danger btn-sm delete-btn">
                            <span class="material-symbols-rounded">delete</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

allTestsContainer?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    
    // Handle empty state create button
    if (target.closest('[data-action="create"]')) {
        showView(createTestView);
        return;
    }
    
    const testItem = target.closest('.test-item') as HTMLElement;
    if (!testItem) return;

    const testId = testItem.dataset.testid;
    const tests = getFromStorage<Test[]>('tests', []);
    const test = tests.find(t => t.id === testId);
    if (!test) return;

    if (target.closest('.start-btn')) {
        startTest(test);
    } else if (target.closest('.download-btn')) {
        handleDownloadTest(test);
    } else if (target.closest('.delete-btn')) {
        handleDeleteTest(testId || '');
    } else if (target.closest('.edit-btn')) {
        currentTest = JSON.parse(JSON.stringify(test));
        renderEditableTest(currentTest);
        showView(editTestView);
    } else if (!target.closest('button')) {
        renderTestDetail(test);
        showView(testDetailView);
    }
});

importTestBtn?.addEventListener('click', () => importTestInput?.click());
importTestInput?.addEventListener('change', handleImportTest);

function handleDownloadTest(test: Test) {
    const jsonString = JSON.stringify(test, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fileName = `test-${test.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Test downloaded!', 'success');
}

function handleDeleteTest(testId: string) {
    if (confirm("Are you sure you want to delete this test?")) {
        let tests = getFromStorage<Test[]>('tests', []);
        tests = tests.filter(t => t.id !== testId);
        saveToStorage('tests', tests);
        renderAllTests();
        showToast('Test deleted', 'success');
    }
}

function handleImportTest(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const text = e.target?.result as string;
            const importedData = JSON.parse(text);

            if (typeof importedData.name !== 'string' || !Array.isArray(importedData.questions)) {
                throw new Error("Invalid test file format.");
            }

            const newTest: Test = {
                ...importedData,
                id: `test_${Date.now()}`,
                name: `${importedData.name} (Imported)`,
                createdAt: new Date().toISOString(),
                marksPerQuestion: importedData.marksPerQuestion || 2,
                negativeMarking: importedData.negativeMarking || 0.66
            };

            const tests = getFromStorage<Test[]>('tests', []);
            tests.unshift(newTest);
            saveToStorage('tests', tests);

            showToast(`Test "${newTest.name}" imported!`, 'success');
            renderAllTests();
        } catch (error: any) {
            showToast(`Failed to import test. ${error.message}`, 'error');
        } finally {
            input.value = '';
        }
    };
    reader.readAsText(file);
}

// --- Test Detail Logic ---
function renderTestDetail(test: Test) {
    currentTest = test;
    if (testDetailTitle) testDetailTitle.textContent = test.name;
    
    if (testDetailContainer) {
        testDetailContainer.innerHTML = `
            <div class="test-info-card">
                <div class="test-meta">
                    <span class="meta-tag">
                        <span class="material-symbols-rounded">quiz</span>
                        ${test.questions.length} Questions
                    </span>
                    <span class="meta-tag">
                        <span class="material-symbols-rounded">timer</span>
                        ${test.duration} mins
                    </span>
                    <span class="meta-tag">
                        <span class="material-symbols-rounded">language</span>
                        ${test.language}
                    </span>
                    <span class="meta-tag">
                        <span class="material-symbols-rounded">grade</span>
                        ${test.marksPerQuestion} marks/Q
                    </span>
                </div>
            </div>
            ${test.questions.slice(0, 3).map((q, index) => `
                <div class="detail-question">
                    <span class="question-number">Q${index + 1}</span>
                    <p class="question-text">${q.question}</p>
                    <ul class="detail-options">
                        ${q.options.map((opt, optIndex) => `
                            <li class="detail-option ${q.answer === optIndex ? 'correct' : ''}">${opt}</li>
                        `).join('')}
                    </ul>
                </div>
            `).join('')}
            ${test.questions.length > 3 ? `<p style="text-align: center; color: var(--text-muted);">... and ${test.questions.length - 3} more questions</p>` : ''}
        `;
    }
}

startTestBtn?.addEventListener('click', () => {
    if (currentTest) startTest(currentTest);
});

editTestDetailBtn?.addEventListener('click', () => {
    if (currentTest) {
        currentTest = JSON.parse(JSON.stringify(currentTest));
        renderEditableTest(currentTest);
        showView(editTestView);
    }
});

deleteTestBtn?.addEventListener('click', () => {
    if (currentTest && confirm(`Delete "${currentTest.name}"?`)) {
        handleDeleteTest(currentTest.id);
        showView(allTestsView);
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

    if (attemptTestTitle) attemptTestTitle.textContent = test.name;
    if (totalQNum) totalQNum.textContent = test.questions.length.toString();
    
    renderQuestionForAttempt();
    updatePalette();
    startTimer();
    showView(testAttemptView);
}

function renderQuestionForAttempt() {
    if (!currentTest) return;
    const q = currentTest.questions[currentQuestionIndex];
    
    if (currentQNum) currentQNum.textContent = (currentQuestionIndex + 1).toString();
    
    if (questionContentContainer) {
        questionContentContainer.innerHTML = `
            <p class="question-text">${q.question}</p>
            <ul class="attempt-options">
                ${q.options.map((opt, index) => `
                    <li class="attempt-option">
                        <label>
                            <input type="radio" name="option" value="${index}" ${userAnswers[currentQuestionIndex] === index ? 'checked' : ''}>
                            <span class="option-marker">${String.fromCharCode(65 + index)}</span>
                            <span class="option-text">${opt}</span>
                        </label>
                    </li>
                `).join('')}
            </ul>
        `;
    }
}

function updatePalette() {
    if (!currentTest || !questionPaletteContainer) return;
    
    questionPaletteContainer.innerHTML = currentTest.questions.map((_, index) => {
        const status = questionStatuses[index];
        const isCurrent = index === currentQuestionIndex;
        let statusClass = '';
        
        switch (status) {
            case 'answered': statusClass = 'answered'; break;
            case 'notAnswered': statusClass = 'not-answered'; break;
            case 'marked': statusClass = 'marked'; break;
            case 'markedAndAnswered': statusClass = 'marked-answered'; break;
            default: statusClass = '';
        }
        
        return `<button class="palette-btn ${statusClass} ${isCurrent ? 'current' : ''}" data-index="${index}">${index + 1}</button>`;
    }).join('');
}

questionPaletteContainer?.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('palette-btn')) {
        const newIndex = parseInt(target.dataset.index || '0', 10);
        if (newIndex !== currentQuestionIndex) {
            navigateToQuestion(newIndex);
        }
    }
});

togglePaletteBtn?.addEventListener('click', () => {
    palettePanel?.classList.toggle('collapsed');
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
    if (!currentTest) return;
    
    const timeSpent = (Date.now() - questionStartTime) / 1000;
    timePerQuestion[currentQuestionIndex] += timeSpent;

    saveCurrentAnswer();

    if (newIndex >= currentTest.questions.length) {
        updatePalette();
        return;
    }
    if (newIndex < 0) {
        return;
    }

    currentQuestionIndex = newIndex;
    questionStartTime = Date.now();

    if (questionStatuses[currentQuestionIndex] === 'notVisited') {
        questionStatuses[currentQuestionIndex] = 'notAnswered';
    }
    renderQuestionForAttempt();
    updatePalette();
}

saveNextBtn?.addEventListener('click', () => navigateToQuestion(currentQuestionIndex + 1));
prevQuestionBtn?.addEventListener('click', () => navigateToQuestion(currentQuestionIndex - 1));

clearResponseBtn?.addEventListener('click', () => {
    const selectedOption = document.querySelector('input[name="option"]:checked') as HTMLInputElement;
    if (selectedOption) selectedOption.checked = false;
});

markReviewBtn?.addEventListener('click', () => {
    const currentStatus = questionStatuses[currentQuestionIndex];
    if (currentStatus === 'answered' || currentStatus === 'markedAndAnswered') {
        questionStatuses[currentQuestionIndex] = 'markedAndAnswered';
    } else {
        questionStatuses[currentQuestionIndex] = 'marked';
    }
    navigateToQuestion(currentQuestionIndex + 1);
});

submitTestBtn?.addEventListener('click', () => {
    if (confirm('Are you sure you want to submit this test?')) {
        handleSubmitTest();
    }
});

abandonTestBtn?.addEventListener('click', () => {
    if (confirm('Are you sure you want to abandon this test? Your progress will be lost.')) {
        stopTimer();
        currentTest = null;
        updateDashboardStats();
        renderRecentTests();
        showView(dashboardView);
    }
});

function handleSubmitTest() {
    try {
        stopTimer();
        
        const timeSpent = (Date.now() - questionStartTime) / 1000;
        timePerQuestion[currentQuestionIndex] += timeSpent;
        saveCurrentAnswer();

        if (!currentTest) {
            showToast("Error: Test data is missing.", 'error');
            showView(dashboardView);
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

        const marksPerQ = currentTest.marksPerQuestion || 2;
        const negMark = currentTest.negativeMarking || 0.66;
        const rawScore = (correctAnswers * marksPerQ) - (incorrectAnswers * negMark);
        const totalMaxScore = currentTest.questions.length * marksPerQ;
        const scorePercentage = totalMaxScore > 0 ? Math.max(0, (rawScore / totalMaxScore) * 100) : 0;
        
        const attempt: TestAttempt = {
            testId: currentTest.id,
            testName: currentTest.name,
            userAnswers,
            timeTaken: (currentTest.duration * 60) - timeRemaining,
            timePerQuestion,
            completedAt: new Date().toISOString(),
            score: scorePercentage,
            totalQuestions: currentTest.questions.length,
            correctAnswers,
            incorrectAnswers,
            unanswered,
            fullTest: currentTest
        };

        const history = getFromStorage<TestAttempt[]>('performanceHistory', []);
        history.unshift(attempt);
        saveToStorage('performanceHistory', history);

        currentTest = null;
        
        renderPerformanceReport(attempt, false);
        showView(performanceReportView);
        showToast('Test submitted successfully!', 'success');

    } catch (error) {
        console.error("Error during test submission:", error);
        showToast("An error occurred while submitting your test.", 'error');
        showView(dashboardView);
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
        if (timeLeftEl) {
            timeLeftEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
        
        if (timeRemaining <= 0) {
            stopTimer();
            showToast("Time's up! Submitting test...", 'warning');
            handleSubmitTest();
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) window.clearInterval(timerInterval);
    timerInterval = null;
}

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
    if (testAttemptView?.classList.contains('hidden')) return;

    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    switch (e.key) {
        case '1':
        case '2':
        case '3':
        case '4':
            e.preventDefault();
            const optionIndex = parseInt(e.key, 10) - 1;
            const radioButtons = document.querySelectorAll('.attempt-option input[type="radio"]') as NodeListOf<HTMLInputElement>;
            if (radioButtons[optionIndex]) {
                radioButtons[optionIndex].checked = true;
            }
            break;
        case ' ':
            e.preventDefault();
            saveNextBtn?.click();
            break;
        case 'm':
        case 'M':
            e.preventDefault();
            markReviewBtn?.click();
            break;
        case 'c':
        case 'C':
            e.preventDefault();
            clearResponseBtn?.click();
            break;
    }
});

// --- Performance Logic ---
function renderPerformanceHistory() {
    const history = getFromStorage<TestAttempt[]>('performanceHistory', []);
    
    if (history.length === 0) {
        if (performanceContainer) {
            performanceContainer.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-rounded">trending_up</span>
                    <h3>No Results Yet</h3>
                    <p>Complete tests to see your performance</p>
                </div>
            `;
        }
        return;
    }

    if (performanceContainer) {
        performanceContainer.innerHTML = history.map((attempt, index) => {
            const date = new Date(attempt.completedAt).toLocaleDateString();
            const time = new Date(attempt.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const scoreClass = attempt.score >= 50 ? 'pass' : 'fail';
            const timeTakenMins = Math.floor(attempt.timeTaken / 60);

            return `
                <div class="performance-card" data-attempt-index="${index}">
                    <div>
                        <h3>${attempt.testName}</h3>
                        <div class="performance-meta">
                            <span><span class="material-symbols-rounded">calendar_today</span> ${date} at ${time}</span>
                        </div>
                        <div class="performance-stats">
                            <span class="stat-pill">
                                <span class="material-symbols-rounded">check_circle</span>
                                ${attempt.correctAnswers} Correct
                            </span>
                            <span class="stat-pill">
                                <span class="material-symbols-rounded">cancel</span>
                                ${attempt.incorrectAnswers} Wrong
                            </span>
                            <span class="stat-pill">
                                <span class="material-symbols-rounded">timer</span>
                                ${timeTakenMins}m
                            </span>
                        </div>
                    </div>
                    <div class="score-badge ${scoreClass}">${attempt.score.toFixed(0)}%</div>
                </div>
            `;
        }).join('');
    }
}

performanceContainer?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest('.performance-card') as HTMLElement;
    if (card) {
        const index = parseInt(card.dataset.attemptIndex || '0', 10);
        const history = getFromStorage<TestAttempt[]>('performanceHistory', []);
        if (history[index]) {
            renderPerformanceReport(history[index], true);
            showView(performanceReportView);
        }
    }
});

function renderPerformanceReport(attempt: TestAttempt, fromHistory: boolean = true) {
    currentAttemptForReport = attempt;
    reportReturnView = fromHistory ? performanceView : allTestsView;

    if (performanceReportTitle) performanceReportTitle.textContent = `Result: ${attempt.testName}`;
    
    const attemptedCount = attempt.correctAnswers + attempt.incorrectAnswers;
    const accuracy = attemptedCount > 0 ? (attempt.correctAnswers / attemptedCount) * 100 : 0;
    
    if (performanceSummaryContainer) {
        performanceSummaryContainer.innerHTML = `
            <div class="summary-card score">
                <div class="summary-icon"><span class="material-symbols-rounded">percent</span></div>
                <div class="summary-value">${attempt.score.toFixed(1)}%</div>
                <div class="summary-label">Score</div>
            </div>
            <div class="summary-card accuracy">
                <div class="summary-icon"><span class="material-symbols-rounded">track_changes</span></div>
                <div class="summary-value">${accuracy.toFixed(1)}%</div>
                <div class="summary-label">Accuracy</div>
            </div>
            <div class="summary-card correct">
                <div class="summary-icon"><span class="material-symbols-rounded">check_circle</span></div>
                <div class="summary-value">${attempt.correctAnswers}</div>
                <div class="summary-label">Correct</div>
            </div>
            <div class="summary-card incorrect">
                <div class="summary-icon"><span class="material-symbols-rounded">cancel</span></div>
                <div class="summary-value">${attempt.incorrectAnswers}</div>
                <div class="summary-label">Incorrect</div>
            </div>
            <div class="summary-card unanswered">
                <div class="summary-icon"><span class="material-symbols-rounded">help</span></div>
                <div class="summary-value">${attempt.unanswered}</div>
                <div class="summary-label">Unanswered</div>
            </div>
            <div class="summary-card time">
                <div class="summary-icon"><span class="material-symbols-rounded">timer</span></div>
                <div class="summary-value">${Math.floor(attempt.timeTaken / 60)}m</div>
                <div class="summary-label">Time Taken</div>
            </div>
        `;
    }

    renderMistakesReview(attempt);
    renderAllQuestionsReview(attempt);
    renderSubjectBreakdown(attempt);
    renderTimeAnalysis(attempt);
    
    // Reset tabs
    document.querySelectorAll('.report-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.report-content').forEach(content => content.classList.remove('active'));
    document.querySelector('.report-tab[data-target="mistakes-view"]')?.classList.add('active');
    mistakesReviewContainer?.classList.add('active');

    if (downloadReportBtn) {
        downloadReportBtn.onclick = () => handleDownloadReport(attempt);
    }
}

// Report Tabs
document.querySelector('.report-tabs')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const tab = target.closest('.report-tab') as HTMLElement;
    if (!tab) return;
    
    document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.report-content').forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    const targetId = tab.dataset.target;
    if (targetId) {
        document.getElementById(targetId)?.classList.add('active');
    }
});

function createQuestionReviewHTML(q: Question, index: number, attempt: TestAttempt): string {
    const userAnswer = attempt.userAnswers[index];
    let statusClass = 'unanswered';
    let statusText = 'Unanswered';

    if (userAnswer === q.answer) {
        statusClass = 'correct';
        statusText = 'Correct';
    } else if (userAnswer !== null) {
        statusClass = 'incorrect';
        statusText = 'Incorrect';
    }

    return `
        <details class="review-item ${statusClass}">
            <summary class="review-summary">
                <span class="review-number">Q${index + 1}</span>
                <span class="review-status ${statusClass}"></span>
                <span class="review-preview">${q.question.substring(0, 60)}...</span>
                <span class="material-symbols-rounded review-expand">expand_more</span>
            </summary>
            <div class="review-body">
                <p class="question-text">${q.question}</p>
                <ul class="review-options">
                    ${q.options.map((opt, optIndex) => {
                        let optClass = '';
                        if (optIndex === q.answer) optClass = 'correct';
                        if (optIndex === userAnswer && userAnswer !== q.answer) optClass = 'user-wrong';
                        return `<li class="review-option ${optClass}">${opt}</li>`;
                    }).join('')}
                </ul>
                <div class="explanation-box">
                    <h4>Explanation</h4>
                    <p>${q.explanation}</p>
                </div>
            </div>
        </details>
    `;
}

function renderMistakesReview(attempt: TestAttempt) {
    const mistakes = attempt.fullTest.questions
        .map((q, index) => ({ q, index }))
        .filter(({ index }) => {
            const userAnswer = attempt.userAnswers[index];
            return userAnswer !== null && userAnswer !== attempt.fullTest.questions[index].answer;
        });

    if (mistakesReviewContainer) {
        if (mistakes.length === 0) {
            mistakesReviewContainer.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-rounded">celebration</span>
                    <h3>No Mistakes!</h3>
                    <p>Great job on this test!</p>
                </div>
            `;
        } else {
            mistakesReviewContainer.innerHTML = mistakes
                .map(({ q, index }) => createQuestionReviewHTML(q, index, attempt))
                .join('');
        }
    }
}

function renderAllQuestionsReview(attempt: TestAttempt) {
    if (allQuestionsReviewContainer) {
        allQuestionsReviewContainer.innerHTML = attempt.fullTest.questions
            .map((q, index) => createQuestionReviewHTML(q, index, attempt))
            .join('');
    }
}

function renderSubjectBreakdown(attempt: TestAttempt) {
    const subjectStats: { [key: string]: { correct: number, total: number } } = {};
    
    attempt.fullTest.questions.forEach((q, i) => {
        const subject = q.subject || 'Uncategorized';
        if (!subjectStats[subject]) {
            subjectStats[subject] = { correct: 0, total: 0 };
        }
        subjectStats[subject].total++;
        if (attempt.userAnswers[i] === q.answer) {
            subjectStats[subject].correct++;
        }
    });

    if (subjectBreakdownContainer) {
        subjectBreakdownContainer.innerHTML = Object.entries(subjectStats).map(([subject, stats]) => {
            const accuracy = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
            const color = accuracy > 60 ? 'var(--success)' : accuracy > 40 ? 'var(--warning)' : 'var(--danger)';
            return `
                <div class="subject-item">
                    <div class="subject-header">
                        <h4>${subject}</h4>
                        <span class="subject-accuracy" style="color: ${color}">${accuracy.toFixed(0)}%</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${accuracy}%; background: ${color}"></div>
                    </div>
                    <p style="font-size: 0.85rem; color: var(--text-muted)">${stats.correct}/${stats.total} correct</p>
                </div>
            `;
        }).join('');
    }
}

function renderTimeAnalysis(attempt: TestAttempt) {
    const maxTime = Math.max(...attempt.timePerQuestion, 1);
    
    if (timeAnalysisContainer) {
        timeAnalysisContainer.innerHTML = `
            <h4 style="margin-bottom: 1rem;">Time Spent Per Question</h4>
            <div class="time-chart">
                ${attempt.timePerQuestion.map((time, index) => {
                    const q = attempt.fullTest.questions[index];
                    const userAnswer = attempt.userAnswers[index];
                    let barClass = 'unanswered';
                    if (userAnswer === q.answer) barClass = 'correct';
                    else if (userAnswer !== null) barClass = 'incorrect';
                    
                    const width = (time / maxTime) * 100;
                    return `
                        <div class="chart-row">
                            <span class="chart-label">Q${index + 1}</span>
                            <div class="chart-bar-wrapper">
                                <div class="chart-bar ${barClass}" style="width: ${width}%"></div>
                            </div>
                            <span class="chart-value">${time.toFixed(1)}s</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }
}

function handleDownloadReport(attempt: TestAttempt) {
    let report = `Test Report: ${attempt.testName}\n`;
    report += `Date: ${new Date(attempt.completedAt).toLocaleString()}\n`;
    report += `${'='.repeat(50)}\n\n`;
    report += `Score: ${attempt.score.toFixed(2)}%\n`;
    report += `Correct: ${attempt.correctAnswers}\n`;
    report += `Incorrect: ${attempt.incorrectAnswers}\n`;
    report += `Unanswered: ${attempt.unanswered}\n`;
    report += `Time Taken: ${Math.floor(attempt.timeTaken / 60)}m ${attempt.timeTaken % 60}s\n\n`;
    report += `${'='.repeat(50)}\n\n`;
    
    attempt.fullTest.questions.forEach((q, i) => {
        const userAnswer = attempt.userAnswers[i];
        let status = 'Unanswered';
        if (userAnswer === q.answer) status = 'Correct';
        else if (userAnswer !== null) status = 'Incorrect';
        
        report += `Q${i + 1}: ${q.question}\n`;
        report += `Your Answer: ${userAnswer !== null ? q.options[userAnswer] : 'None'}\n`;
        report += `Correct Answer: ${q.options[q.answer]}\n`;
        report += `Status: ${status}\n`;
        report += `Explanation: ${q.explanation}\n\n`;
    });
    
    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${attempt.testName.replace(/[^a-zA-Z0-9]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Report downloaded!', 'success');
}

// --- Analytics Logic ---
function renderAnalyticsDashboard() {
    const history = getFromStorage<TestAttempt[]>('performanceHistory', []);
    
    if (history.length === 0) {
        if (analyticsStatsGrid) {
            analyticsStatsGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1;">
                    <span class="material-symbols-rounded">analytics</span>
                    <h3>No Data Yet</h3>
                    <p>Complete some tests to see analytics</p>
                </div>
            `;
        }
        if (subjectMasteryContainer) subjectMasteryContainer.innerHTML = '';
        return;
    }

    aggregatedSubjectData = {};
    let totalQuestions = 0;
    let totalCorrect = 0;
    let totalScoreSum = 0;
    let totalTimeTaken = 0;

    history.forEach(attempt => {
        totalQuestions += attempt.totalQuestions;
        totalCorrect += attempt.correctAnswers;
        totalScoreSum += attempt.score;
        totalTimeTaken += attempt.timeTaken;

        attempt.fullTest.questions.forEach((q, i) => {
            const subject = q.subject || 'Uncategorized';
            const topic = q.topic || 'General';
            
            if (!aggregatedSubjectData[subject]) {
                aggregatedSubjectData[subject] = { correct: 0, total: 0, totalTime: 0, topics: {} };
            }
            aggregatedSubjectData[subject].total++;
            aggregatedSubjectData[subject].totalTime += attempt.timePerQuestion[i] || 0;
            
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

    const avgScore = totalScoreSum / history.length;
    const overallAccuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;
    const hours = Math.floor(totalTimeTaken / 3600);
    const mins = Math.floor((totalTimeTaken % 3600) / 60);

    if (analyticsStatsGrid) {
        analyticsStatsGrid.innerHTML = `
            <div class="stat-card">
                <div class="stat-icon"><span class="material-symbols-rounded">history</span></div>
                <div class="stat-info">
                    <span class="stat-value">${history.length}</span>
                    <span class="stat-label">Tests Taken</span>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><span class="material-symbols-rounded">percent</span></div>
                <div class="stat-info">
                    <span class="stat-value">${avgScore.toFixed(1)}%</span>
                    <span class="stat-label">Avg Score</span>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><span class="material-symbols-rounded">target</span></div>
                <div class="stat-info">
                    <span class="stat-value">${overallAccuracy.toFixed(1)}%</span>
                    <span class="stat-label">Accuracy</span>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><span class="material-symbols-rounded">schedule</span></div>
                <div class="stat-info">
                    <span class="stat-value">${hours}h ${mins}m</span>
                    <span class="stat-label">Study Time</span>
                </div>
            </div>
        `;
    }

    const sortedSubjects = Object.entries(aggregatedSubjectData)
        .map(([subject, stats]) => ({
            subject,
            accuracy: (stats.correct / stats.total) * 100,
            count: stats.total
        }))
        .sort((a, b) => b.accuracy - a.accuracy);

    if (subjectMasteryContainer) {
        subjectMasteryContainer.innerHTML = sortedSubjects.map(s => {
            const color = s.accuracy > 60 ? 'var(--success)' : s.accuracy > 40 ? 'var(--warning)' : 'var(--danger)';
            return `
                <div class="subject-card" data-subject="${s.subject}">
                    <div class="subject-card-header">
                        <h3>${s.subject}</h3>
                        <span class="material-symbols-rounded">chevron_right</span>
                    </div>
                    <div class="subject-card-stats">
                        <div class="stat-row">
                            <span>Accuracy</span>
                            <span style="color: ${color}; font-weight: 700">${s.accuracy.toFixed(1)}%</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${s.accuracy}%; background: ${color}"></div>
                        </div>
                        <p style="font-size: 0.8rem; color: var(--text-muted)">${s.count} questions attempted</p>
                    </div>
                </div>
            `;
        }).join('');
    }
}

subjectMasteryContainer?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest('.subject-card') as HTMLElement;
    if (card) {
        const subject = card.dataset.subject;
        if (subject) openSubjectModal(subject);
    }
});

function openSubjectModal(subject: string) {
    const data = aggregatedSubjectData[subject];
    if (!data) return;

    if (modalSubjectTitle) modalSubjectTitle.textContent = `${subject} Analysis`;
    
    const accuracy = (data.correct / data.total) * 100;
    const avgTime = data.total > 0 ? (data.totalTime / data.total) : 0;
    const color = accuracy > 60 ? 'var(--success)' : accuracy > 40 ? 'var(--warning)' : 'var(--danger)';

    const sortedTopics = Object.entries(data.topics)
        .map(([topic, stats]) => ({
            topic,
            accuracy: (stats.correct / stats.total) * 100,
            correct: stats.correct,
            total: stats.total
        }))
        .sort((a, b) => b.accuracy - a.accuracy);

    if (modalBody) {
        modalBody.innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.5rem;">
                <div style="background: var(--bg-input); padding: 1rem; border-radius: var(--radius-md); text-align: center;">
                    <div style="font-size: 0.75rem; color: var(--text-muted)">Accuracy</div>
                    <div style="font-size: 1.25rem; font-weight: 700; color: ${color}">${accuracy.toFixed(1)}%</div>
                </div>
                <div style="background: var(--bg-input); padding: 1rem; border-radius: var(--radius-md); text-align: center;">
                    <div style="font-size: 0.75rem; color: var(--text-muted)">Questions</div>
                    <div style="font-size: 1.25rem; font-weight: 700">${data.total}</div>
                </div>
                <div style="background: var(--bg-input); padding: 1rem; border-radius: var(--radius-md); text-align: center;">
                    <div style="font-size: 0.75rem; color: var(--text-muted)">Avg Time</div>
                    <div style="font-size: 1.25rem; font-weight: 700">${avgTime.toFixed(1)}s</div>
                </div>
            </div>
            
            <h4 style="margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border)">Topic Performance</h4>
            ${sortedTopics.map(t => {
                const topicColor = t.accuracy > 60 ? 'var(--success)' : t.accuracy > 40 ? 'var(--warning)' : 'var(--danger)';
                return `
                    <div style="background: var(--bg-input); padding: 0.75rem; border-radius: var(--radius-sm); margin-bottom: 0.5rem;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
                            <span>${t.topic}</span>
                            <span style="color: ${topicColor}; font-weight: 600">${t.accuracy.toFixed(0)}%</span>
                        </div>
                        <div class="progress-bar" style="height: 6px;">
                            <div class="progress-fill" style="width: ${t.accuracy}%; background: ${topicColor}"></div>
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem">${t.correct}/${t.total} correct</div>
                    </div>
                `;
            }).join('')}
        `;
    }

    analyticsModal?.classList.remove('hidden');
}

closeModalBtn?.addEventListener('click', () => {
    analyticsModal?.classList.add('hidden');
});

analyticsModal?.addEventListener('click', (e) => {
    if (e.target === analyticsModal) {
        analyticsModal.classList.add('hidden');
    }
});

// --- Bookmarks Logic ---
function renderBookmarks() {
    const bookmarks = getFromStorage<any[]>('bookmarks', []);
    
    if (bookmarksContainer) {
        if (bookmarks.length === 0) {
            bookmarksContainer.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-rounded">bookmark_border</span>
                    <h3>No Bookmarks Yet</h3>
                    <p>Save questions during test review to find them here</p>
                </div>
            `;
        } else {
            bookmarksContainer.innerHTML = bookmarks.map(b => `
                <div class="bookmark-card">
                    <p class="question-text">${b.question}</p>
                    <div class="bookmark-meta">
                        <span>${b.subject}</span>
                        <span>•</span>
                        <span>${b.topic}</span>
                    </div>
                </div>
            `).join('');
        }
    }
}

// --- Initialize ---
checkExistingSession();
