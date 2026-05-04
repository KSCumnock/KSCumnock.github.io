// ====================================================================
// EMPLOYEE PORTAL — search, filter and sort
// State persists to localStorage so it survives reloads.
// ====================================================================
const EMP_LOW_DAYS_THRESHOLD = 5;

const EMP_VIEW_STATE = (() => {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem('ks-emp-view') || '{}'); } catch {}
    return {
        search:  '',
        filter:  stored.filter || 'all',
        sort:    stored.sort   || 'name-asc'
    };
})();

function persistEmpViewState() {
    try {
        localStorage.setItem('ks-emp-view', JSON.stringify({
            filter: EMP_VIEW_STATE.filter,
            sort:   EMP_VIEW_STATE.sort
        }));
    } catch {}
}

// Build a per-employee summary used by both filters and the card render.
function summariseEmployee(employee) {
    const reqs = holidayRequests.filter(r => r.employeeId === employee.id);
    const approved = reqs.filter(r => r.status === 'approved');
    const pending  = reqs.filter(r => r.status === 'pending');
    const remaining = (employee.totalAllowance || 0) - (employee.usedDays || 0);

    const today = new Date().toISOString().split('T')[0];

    // On leave today? (covers block bookings + range bookings)
    const onLeaveNow = approved.some(r => {
        if (r.isBlockBooking && Array.isArray(r.selectedDates)) {
            return r.selectedDates.includes(today);
        }
        return r.startDate <= today && r.endDate >= today;
    });

    // Next upcoming approved leave
    const upcoming = approved
        .filter(r => r.startDate >= today)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const nextLeaveDate = upcoming[0] ? upcoming[0].startDate : null;
    const nextLeave    = upcoming[0] || null;

    return {
        employee,
        reqs, approved, pending,
        remaining,
        onLeaveNow,
        hasPending: pending.length > 0,
        lowDays:    remaining <= EMP_LOW_DAYS_THRESHOLD,
        nextLeave,
        nextLeaveDate
    };
}

function passesFilter(summary, filter) {
    switch (filter) {
        case 'has-pending':  return summary.hasPending;
        case 'on-leave-now': return summary.onLeaveNow;
        case 'low-days':     return summary.lowDays;
        default:             return true;
    }
}

function passesSearch(summary, search) {
    if (!search) return true;
    return summary.employee.name.toLowerCase().includes(search);
}

function sortSummaries(list, sort) {
    const cmpName  = (a, b) => a.employee.name.localeCompare(b.employee.name);
    const cmpName2 = (a, b) => b.employee.name.localeCompare(a.employee.name);

    switch (sort) {
        case 'name-desc':     return [...list].sort(cmpName2);
        case 'days-desc':     return [...list].sort((a, b) => b.remaining - a.remaining || cmpName(a, b));
        case 'days-asc':      return [...list].sort((a, b) => a.remaining - b.remaining || cmpName(a, b));
        case 'pending-desc':  return [...list].sort((a, b) => b.pending.length - a.pending.length || cmpName(a, b));
        case 'next-leave':    return [...list].sort((a, b) => {
            // Upcoming first, then no-upcoming. Soonest date wins.
            if (a.nextLeaveDate && !b.nextLeaveDate) return -1;
            if (!a.nextLeaveDate && b.nextLeaveDate) return 1;
            if (!a.nextLeaveDate && !b.nextLeaveDate) return cmpName(a, b);
            return a.nextLeaveDate.localeCompare(b.nextLeaveDate);
        });
        case 'name-asc':
        default:              return [...list].sort(cmpName);
    }
}

// Update the chip counts (and the All count) for the current employee set.
function updateFilterChipCounts(summaries) {
    const counts = {
        'all':          summaries.length,
        'has-pending':  summaries.filter(s => s.hasPending).length,
        'on-leave-now': summaries.filter(s => s.onLeaveNow).length,
        'low-days':     summaries.filter(s => s.lowDays).length
    };
    document.querySelectorAll('.chip-count[data-count]').forEach(el => {
        const key = el.dataset.count;
        const n = counts[key] || 0;
        el.textContent = n;
        el.classList.toggle('is-zero', n === 0);
    });
}

function filterEmployeeCards() {
    // Kept as legacy entry point — just re-render with the latest search.
    EMP_VIEW_STATE.search = (document.getElementById('employee-search')?.value || '').toLowerCase().trim();
    const clearBtn = document.getElementById('emp-search-clear');
    if (clearBtn) clearBtn.classList.toggle('hidden', !EMP_VIEW_STATE.search);
    populateEmployeeCards();
}

// Configuration - GitHub Integration via Cloudflare Worker
const GITHUB_CONFIG = {
    owner: 'KSCumnock',
    repo: 'Holidays',
    branch: 'main',
    workerUrl: 'https://ks-holiday-manager.ske-d03.workers.dev/api/github'
};

// Email Configuration
const EMAIL_CONFIG = {
    serviceId: 'service_uhfejsl',
    publicKey: 'cB2IeD1LQI51b-1sG',
    
    // Template IDs for different notification types
    templates: {
        employeeNotification: 'template_i5sq3ci',  // For approve/decline/cancel notifications to employees
        adminNotification: 'template_79v1u6v'      // For new submission notifications to admins
    },
    
    // Admin email - Use Office 365 group/distribution list
    // Set this up in Office 365 and add all admins as members
    adminEmail: 'holidayrequest@kerrandsmith.co.uk'  // Replace with your actual group email
};

// To setup EmailJS:
// 1. Go to https://www.emailjs.com/
// 2. Create a free account
// 3. Add an email service (Gmail, Outlook, etc.)
// 4. Create TWO templates:
//    a) Employee notification template (for approve/decline/cancel)
//    b) Admin notification template (for new submissions)
// 5. Copy your Service ID, Template IDs, and Public Key to the config above

// Data storage with GitHub SHA tracking
let employees = [];
let holidayRequests = [];
let employeesSha = null;
let holidayRequestsSha = null;
let currentEmployee = null;

// ==================== AUTHORISER HELPER ====================
// Prompts the admin for their name before any authorisation action.
// Returns the trimmed name string, or null if cancelled/empty (caller should abort).
function promptAuthoriser(actionText) {
    const name = prompt(
        `Please enter your full name to ${actionText}.\n\n` +
        `This will be recorded for audit purposes.`
    );
    if (name === null) return null;          // user cancelled
    const trimmed = name.trim();
    if (!trimmed) {
        toast.warning('A name is required for audit purposes', { title: 'Action cancelled' });
        return null;
    }
    return trimmed;
}
let nextRequestId = 1;
let nextEmployeeId = 1;
let currentDate = new Date();
let currentPopover = null;
let currentYear = new Date().getFullYear(); // Dynamic current year tracking
let isAdminAuthenticated = false; // Track admin session

// Block booking variables
let isBlockBooking = false;
let selectedDates = [];
let blockCalendarDate = new Date();

// ==================== SCOTLAND PUBLIC & SCHOOL HOLIDAYS ====================
// Source: gov.scot / mygov.scot (bank holidays) and East Ayrshire Council
// (school holidays). Update each year as new dates are confirmed.
//
// Types:
//   'bank'      = Scotland bank holiday
//   'school'    = School term holiday (pupils off)
//   'inservice' = In-service day (pupils off, staff in)
//   'local'     = Local holiday (Ayr Gold Cup weekend, May Day etc.)
const SCOTLAND_HOLIDAYS = [
    // ---------- 2025 Scotland bank holidays ----------
    { date: '2025-01-01', name: "New Year's Day",            type: 'bank' },
    { date: '2025-01-02', name: '2nd January',               type: 'bank' },
    { date: '2025-04-18', name: 'Good Friday',               type: 'bank' },
    { date: '2025-05-05', name: 'Early May bank holiday',    type: 'bank' },
    { date: '2025-05-26', name: 'Spring bank holiday',       type: 'bank' },
    { date: '2025-08-04', name: 'Summer bank holiday',       type: 'bank' },
    { date: '2025-12-01', name: "St Andrew's Day (substitute)", type: 'bank' },
    { date: '2025-12-25', name: 'Christmas Day',             type: 'bank' },
    { date: '2025-12-26', name: 'Boxing Day',                type: 'bank' },

    // ---------- 2026 Scotland bank holidays ----------
    { date: '2026-01-01', name: "New Year's Day",            type: 'bank' },
    { date: '2026-01-02', name: '2nd January',               type: 'bank' },
    { date: '2026-04-03', name: 'Good Friday',               type: 'bank' },
    { date: '2026-05-04', name: 'Early May bank holiday',    type: 'bank' },
    { date: '2026-05-25', name: 'Spring bank holiday',       type: 'bank' },
    { date: '2026-06-15', name: 'Special bank holiday (FIFA World Cup)', type: 'bank' },
    { date: '2026-08-03', name: 'Summer bank holiday',       type: 'bank' },
    { date: '2026-11-30', name: "St Andrew's Day",           type: 'bank' },
    { date: '2026-12-25', name: 'Christmas Day',             type: 'bank' },
    { date: '2026-12-28', name: 'Boxing Day (substitute)',   type: 'bank' },

    // ---------- 2027 Scotland bank holidays ----------
    { date: '2027-01-01', name: "New Year's Day",            type: 'bank' },
    { date: '2027-01-04', name: '2nd January (substitute)',  type: 'bank' },
    { date: '2027-03-26', name: 'Good Friday',               type: 'bank' },
    { date: '2027-05-03', name: 'Early May bank holiday',    type: 'bank' },
    { date: '2027-05-31', name: 'Spring bank holiday',       type: 'bank' },
    { date: '2027-08-02', name: 'Summer bank holiday',       type: 'bank' },
    { date: '2027-11-30', name: "St Andrew's Day",           type: 'bank' },
    { date: '2027-12-27', name: 'Christmas Day (substitute)', type: 'bank' },
    { date: '2027-12-28', name: 'Boxing Day (substitute)',   type: 'bank' }
];

// East Ayrshire school holidays — given as date ranges (inclusive).
// Source: school-holidays-2025-26.pdf and school-holidays-2026-27.pdf
// (East Ayrshire Council).
// Type:
//   'school'    = pupils off (term holiday / local holiday)
//   'inservice' = in-service day (pupils off)
const SCHOOL_HOLIDAY_RANGES = [
    // ---------- 2025/26 academic year ----------
    { start: '2025-08-18', end: '2025-08-19', name: 'In-service day (start of session)', type: 'inservice' },
    { start: '2025-09-19', end: '2025-09-22', name: 'Local holidays (Ayr Gold Cup weekend)', type: 'school' },
    { start: '2025-10-13', end: '2025-10-17', name: 'October holidays',         type: 'school' },
    { start: '2025-10-20', end: '2025-10-20', name: 'In-service day',           type: 'inservice' },
    { start: '2025-12-22', end: '2026-01-02', name: 'Christmas and New Year',   type: 'school' },
    { start: '2026-02-09', end: '2026-02-09', name: 'Local holiday',            type: 'school' },
    { start: '2026-02-10', end: '2026-02-10', name: 'In-service day',           type: 'inservice' },
    { start: '2026-04-03', end: '2026-04-17', name: 'Easter holidays',          type: 'school' },
    { start: '2026-05-04', end: '2026-05-04', name: 'Local holiday (May Day)',  type: 'school' },
    { start: '2026-05-07', end: '2026-05-07', name: 'In-service day',           type: 'inservice' },
    { start: '2026-06-29', end: '2026-08-14', name: 'Summer holidays',          type: 'school' },

    // ---------- 2026/27 academic year ----------
    { start: '2026-08-17', end: '2026-08-18', name: 'In-service day (start of session)', type: 'inservice' },
    { start: '2026-09-18', end: '2026-09-21', name: 'Local holidays (Ayr Gold Cup weekend)', type: 'school' },
    { start: '2026-10-12', end: '2026-10-16', name: 'October holidays',         type: 'school' },
    { start: '2026-10-19', end: '2026-10-19', name: 'In-service day',           type: 'inservice' },
    { start: '2026-12-21', end: '2027-01-04', name: 'Christmas and New Year',   type: 'school' },
    { start: '2027-02-12', end: '2027-02-15', name: 'Local holidays',           type: 'school' },
    { start: '2027-02-16', end: '2027-02-16', name: 'In-service day',           type: 'inservice' },
    { start: '2027-03-26', end: '2027-04-09', name: 'Easter holidays',          type: 'school' },
    { start: '2027-05-03', end: '2027-05-03', name: 'Local holiday (May Day)',  type: 'school' },
    { start: '2027-05-24', end: '2027-05-24', name: 'In-service day',           type: 'inservice' },
    { start: '2027-06-30', end: '2027-08-13', name: 'Summer holidays',          type: 'school' },
    { start: '2027-08-16', end: '2027-08-17', name: 'In-service day (start of session)', type: 'inservice' }
];

// Returns array of {name, type} for a given YYYY-MM-DD date.
function getHolidaysOnDate(dateStr) {
    const out = [];

    // Bank holidays — exact match on date
    SCOTLAND_HOLIDAYS.forEach(h => {
        if (h.date === dateStr) out.push({ name: h.name, type: h.type });
    });

    // School holidays — fall within [start, end] range
    SCHOOL_HOLIDAY_RANGES.forEach(range => {
        if (dateStr >= range.start && dateStr <= range.end) {
            out.push({ name: range.name, type: range.type });
        }
    });

    return out;
}
// ==================== END HOLIDAYS DATA ====================

// Dynamic file names based on selected year
function getEmployeesFileName() {
    return `employees${currentYear}.json`;
}

function getHolidayRequestsFileName() {
    return `holiday-requests${currentYear}.json`;
}

// GitHub API Functions via Cloudflare Worker
async function getFileFromGitHub(filename) {
    try {
        const response = await fetch(GITHUB_CONFIG.workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'get',
                owner: GITHUB_CONFIG.owner,
                repo: GITHUB_CONFIG.repo,
                path: filename
            })
        });
        
        if (!response.ok) {
            if (response.status === 404) {
                // File doesn't exist, create empty structure
                return {
                    content: [],
                    sha: null
                };
            }
            const errorData = await response.json();
            throw new Error(`Failed to fetch ${filename}: ${errorData.error || response.statusText}`);
        }
        
        const data = await response.json();
        return {
            content: data.content,
            sha: data.sha
        };
    } catch (error) {
        console.error(`Error fetching ${filename}:`, error);
        // Return empty structure if file doesn't exist
        if (error.message.includes('404') || error.message.includes('File not found')) {
            return {
                content: [],
                sha: null
            };
        }
        throw error;
    }
}

async function saveFileToGitHub(filename, content, sha, commitMessage) {
    try {
        const response = await fetch(GITHUB_CONFIG.workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'update',
                owner: GITHUB_CONFIG.owner,
                repo: GITHUB_CONFIG.repo,
                path: filename,
                content: content,
                sha: sha,
                message: commitMessage,
                branch: GITHUB_CONFIG.branch
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Failed to save ${filename}: ${errorData.error || response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error(`Error saving ${filename}:`, error);
        throw error;
    }
}

// API Functions
async function loadEmployees() {
    try {
        const fileData = await getFileFromGitHub(getEmployeesFileName());
        employees = fileData.content;
        employeesSha = fileData.sha;
        
        // Update next ID based on existing data
        if (employees.length > 0) {
            nextEmployeeId = Math.max(...employees.map(emp => emp.id)) + 1;
        }
        
        return employees;
    } catch (error) {
        console.error('Error loading employees:', error);
        throw error;
    }
}

async function loadHolidayRequests() {
    try {
        const fileData = await getFileFromGitHub(getHolidayRequestsFileName());
        holidayRequests = fileData.content;
        holidayRequestsSha = fileData.sha;
        
        // Update next ID based on existing data
        if (holidayRequests.length > 0) {
            nextRequestId = Math.max(...holidayRequests.map(req => req.id)) + 1;
        }
        
        return holidayRequests;
    } catch (error) {
        console.error('Error loading holiday requests:', error);
        throw error;
    }
}

async function saveEmployees() {
    try {
        const result = await saveFileToGitHub(
            getEmployeesFileName(), 
            employees, 
            employeesSha, 
            `Update employees data for ${currentYear}`
        );
        employeesSha = result.content.sha;
        console.log(`Employees saved successfully to GitHub for ${currentYear}`);
    } catch (error) {
        console.error('Error saving employees:', error);
        toast.error('Failed to save employee data to GitHub. Please try again.', { title: 'Save failed' });
        throw error;
    }
}

async function saveHolidayRequests() {
    try {
        const result = await saveFileToGitHub(
            getHolidayRequestsFileName(), 
            holidayRequests, 
            holidayRequestsSha, 
            `Update holiday requests data for ${currentYear}`
        );
        holidayRequestsSha = result.content.sha;
        console.log(`Holiday requests saved successfully to GitHub for ${currentYear}`);
    } catch (error) {
        console.error('Error saving holiday requests:', error);
        toast.error('Failed to save holiday request data to GitHub. Please try again.', { title: 'Save failed' });
        throw error;
    }
}

// Year management functions
async function changeYear() {
    const yearSelect = document.getElementById('year-select');
    const newYear = parseInt(yearSelect.value);
    
    if (newYear === currentYear) return;
    
    // Show loading
    document.getElementById('employee-loading').classList.remove('hidden');
    document.getElementById('employee-content').classList.add('hidden');
    const adminLoading = document.getElementById('admin-loading');
    const adminContent = document.getElementById('admin-content');
    if (adminLoading) adminLoading.classList.remove('hidden');
    if (adminContent) adminContent.classList.add('hidden');
    
    // Update current year
    currentYear = newYear;
    var _cyd = document.getElementById('current-year-display'); if (_cyd) _cyd.textContent = `Current: ${currentYear}`;
    
    // Reset data
    employees = [];
    holidayRequests = [];
    employeesSha = null;
    holidayRequestsSha = null;
    currentEmployee = null;
    
    // Clear displays
    document.getElementById('employee-info').classList.add('hidden');
    document.querySelectorAll('.employee-card-selector').forEach(card => {
        card.classList.remove('selected');
    });
    
    try {
        // Load data for new year
        await loadEmployees();
        await loadHolidayRequests();
        
        // Refresh displays
        populateEmployeeCards();
        renderCalendar();
        updatePendingBadge(); // Update badge count
        
        // Refresh admin data if admin panel is active
        const adminTab = document.getElementById('admin-tab');
        if (adminTab && !adminTab.classList.contains('hidden')) {
            await loadAdminData();
        }
        
        document.getElementById('employee-loading').classList.add('hidden');
        document.getElementById('employee-content').classList.remove('hidden');
        
    } catch (error) {
        document.getElementById('employee-loading').classList.add('hidden');
        document.getElementById('employee-error').textContent = `Failed to load data for ${currentYear}: ` + error.message;
        document.getElementById('employee-error').classList.remove('hidden');
    }
}

// Initialize the app
async function init() {
    try {
        // Force hide all modals on startup
        const employeeModal = document.getElementById('employee-modal');
        const pinModal = document.getElementById('pin-modal');
        
        employeeModal.classList.add('hidden');
        employeeModal.style.display = 'none';
        pinModal.classList.add('hidden');
        pinModal.style.display = 'none';
        
        // Check for admin session
        isAdminAuthenticated = sessionStorage.getItem('adminAuthenticated') === 'true';
        
        // Set initial year to current year
        const currentActualYear = new Date().getFullYear();
        const yearSelect = document.getElementById('year-select');
        
        // Check if current year exists in dropdown, if not add it
        let currentYearExists = false;
        for (let option of yearSelect.options) {
            if (parseInt(option.value) === currentActualYear) {
                currentYearExists = true;
                break;
            }
        }
        
        // Dynamically populate year selector centered around current year
        populateYearSelector();
        
        // Set the dropdown to current year
        yearSelect.value = currentActualYear.toString();
        currentYear = currentActualYear;
        var _cyd = document.getElementById('current-year-display'); if (_cyd) _cyd.textContent = `Current: ${currentYear}`;
        
        await loadEmployees();
        await loadHolidayRequests();
        populateEmployeeCards();
        renderCalendar();
        updatePendingBadge(); // Add badge update
        updateAdminStatusIndicator();
        updateTopbarDate();
        showTab('employee');
        
        document.getElementById('employee-loading').classList.add('hidden');
        document.getElementById('employee-content').classList.remove('hidden');
        document.getElementById('start-date').addEventListener('change', updateDaysPreview);
        document.getElementById('end-date').addEventListener('change', updateDaysPreview);
        document.getElementById('half-day-toggle').addEventListener('change', updateDaysPreview);

    } catch (error) {
        document.getElementById('employee-loading').classList.add('hidden');
        document.getElementById('employee-error').textContent = 'Failed to load data: ' + error.message;
        document.getElementById('employee-error').classList.remove('hidden');
    }
}

// Dynamically populate year selector
function populateYearSelector() {
    const yearSelect = document.getElementById('year-select');
    const analyticsYearSelect = document.getElementById('analytics-year-select');
    const currentActualYear = new Date().getFullYear();
    
    // Clear existing options
    yearSelect.innerHTML = '';
    if (analyticsYearSelect) analyticsYearSelect.innerHTML = '';
    
    // Add years from 2 years ago to 5 years in future
    for (let year = currentActualYear - 2; year <= currentActualYear + 5; year++) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        if (year === currentActualYear) {
            option.selected = true;
        }
        yearSelect.appendChild(option);
        
        if (analyticsYearSelect) {
            const analyticsOption = option.cloneNode(true);
            analyticsYearSelect.appendChild(analyticsOption);
        }
    }

    // Explicitly default both selects to the current year
    // (cloneNode doesn't reliably copy the .selected JS property,
    // which previously caused analytics to default to 2024)
    yearSelect.value = currentActualYear;
    if (analyticsYearSelect) analyticsYearSelect.value = currentActualYear;
}

// Update pending badge — drives both the sidebar nav badge and (legacy) any old tab badge
function updatePendingBadge() {
    const pendingCount = holidayRequests.filter(req => req.status === 'pending').length;

    // New sidebar nav badge
    const navBadge = document.getElementById('nav-pending-badge');
    if (navBadge) {
        if (pendingCount > 0) {
            navBadge.textContent = pendingCount;
            navBadge.classList.add('has-pending');
        } else {
            navBadge.textContent = '';
            navBadge.classList.remove('has-pending');
        }
    }
}

// Page metadata for the new sidebar layout
const PAGE_META = {
    employee:  { eyebrow: 'Kerr & Smith Cumnock', title: 'Employees',  subtitle: 'Submit and manage holiday, sick and bereavement requests' },
    calendar:  { eyebrow: 'Kerr & Smith Cumnock', title: 'Calendar',   subtitle: "Team availability with Scotland public &amp; East Ayrshire school holidays" },
    analytics: { eyebrow: 'Kerr & Smith Cumnock', title: 'Analytics',  subtitle: 'Insights into holiday patterns, coverage and forecasts' },
    admin:     { eyebrow: 'Kerr & Smith Cumnock', title: 'Admin Panel', subtitle: 'Approve requests, manage employees and generate reports' }
};

function setActiveNavItem(tabName) {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabName);
    });
    const meta = PAGE_META[tabName];
    if (meta) {
        const eb = document.getElementById('topbar-eyebrow'); if (eb) eb.textContent = meta.eyebrow;
        const tt = document.getElementById('page-title');     if (tt) tt.textContent = meta.title;
        const st = document.getElementById('page-subtitle');  if (st) st.innerHTML = meta.subtitle;
    }
}

// Tab switching
function showTab(tabName) {
    // Mark which content sections are visible
    document.querySelectorAll('.content').forEach(content => content.classList.add('hidden'));

    // Sidebar may be open on mobile — close it after navigation
    closeSidebarOnMobile();

    if (tabName === 'admin') {
        // Check if already authenticated in this session
        if (isAdminAuthenticated) {
            document.getElementById('admin-tab').classList.remove('hidden');
            setActiveNavItem('admin');
            loadAdminData();
        } else {
            openPinModal();
        }
    } else if (tabName === 'calendar') {
        document.getElementById('calendar-tab').classList.remove('hidden');
        setActiveNavItem('calendar');
        renderCalendar();
    } else if (tabName === 'analytics') {
        document.getElementById('analytics-tab').classList.remove('hidden');
        setActiveNavItem('analytics');
        refreshAnalytics();
    } else {
        document.getElementById('employee-tab').classList.remove('hidden');
        setActiveNavItem('employee');
    }
    
    // Close any open popovers
    closePopover();
}

// Mobile sidebar drawer
function toggleSidebar(force) {
    const sidebar  = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!sidebar) return;
    const willOpen = (typeof force === 'boolean') ? force : !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', willOpen);
    if (backdrop) backdrop.classList.toggle('visible', willOpen);
}
function closeSidebarOnMobile() {
    if (window.matchMedia('(max-width: 900px)').matches) {
        toggleSidebar(false);
    }
}

// Render today's date in the topbar meta block
function updateTopbarDate() {
    const el = document.getElementById('topbar-today');
    if (!el) return;
    const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    el.textContent = fmt.format(new Date());
}


// ==================== PIN MODAL ====================
function openPinModal() {
    const modal = document.getElementById('pin-modal');
    const content = document.getElementById('pin-content');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    if (content) {
        content.classList.remove('shake', 'success');
    }
    resetPinDots();
    document.getElementById('pin-input').value = '';
    // Focus the hidden input so physical keyboards still work
    setTimeout(() => document.getElementById('pin-input').focus(), 50);
}

function resetPinDots() {
    document.querySelectorAll('.pin-dot').forEach(d => d.classList.remove('filled'));
    const err = document.getElementById('pin-error-msg');
    if (err) err.classList.remove('visible');
}

function updatePinDots() {
    const value = document.getElementById('pin-input').value;
    document.querySelectorAll('.pin-dot').forEach((dot, idx) => {
        if (idx < value.length) dot.classList.add('filled');
        else                    dot.classList.remove('filled');
    });
    // Hide error as soon as user types again
    const err = document.getElementById('pin-error-msg');
    if (err && err.classList.contains('visible') && value.length > 0) {
        err.classList.remove('visible');
    }
}

function appendPinDigit(digit) {
    const input = document.getElementById('pin-input');
    if (input.value.length >= 4) return;
    input.value += digit;
    updatePinDots();
    if (input.value.length === 4) {
        // Slight delay so user sees the last dot fill
        setTimeout(checkPin, 120);
    }
}

function backspacePin() {
    const input = document.getElementById('pin-input');
    input.value = input.value.slice(0, -1);
    updatePinDots();
}

function updateAdminStatusIndicator() {
    const el = document.getElementById('admin-status');
    if (!el) return;
    const text = el.querySelector('.status-text');
    if (isAdminAuthenticated) {
        el.classList.add('is-admin');
        if (text) text.textContent = 'Admin signed in';
    } else {
        el.classList.remove('is-admin');
        if (text) text.textContent = 'Standard view';
    }
}

// PIN modal functions
async function checkPin() {
    const pin = document.getElementById('pin-input').value;
    const content = document.getElementById('pin-content');

    if (pin === '4224') {
        // Save admin session
        isAdminAuthenticated = true;
        sessionStorage.setItem('adminAuthenticated', 'true');

        if (content) content.classList.add('success');
        // Brief delay for the success animation
        setTimeout(async () => {
            closePinModal();
            document.getElementById('admin-tab').classList.remove('hidden');
            setActiveNavItem('admin');
            updateAdminStatusIndicator();
            await loadAdminData();
        }, 280);
    } else {
        // Shake + show error
        if (content) {
            content.classList.add('shake');
            setTimeout(() => content.classList.remove('shake'), 500);
        }
        const err = document.getElementById('pin-error-msg');
        if (err) err.classList.add('visible');

        document.getElementById('pin-input').value = '';
        setTimeout(() => {
            resetPinDots();
            if (err) err.classList.add('visible'); // keep error visible after reset
        }, 350);
    }
}

function logoutAdmin() {
    isAdminAuthenticated = false;
    sessionStorage.removeItem('adminAuthenticated');
    updateAdminStatusIndicator();
    showTab('employee');
}

function closePinModal() {
    const pinModal = document.getElementById('pin-modal');
    const content = document.getElementById('pin-content');
    pinModal.classList.add('hidden');
    pinModal.style.display = 'none';
    document.getElementById('pin-input').value = '';
    if (content) content.classList.remove('shake', 'success');
    resetPinDots();
}

// Employee functions
function populateEmployeeCards() {
    const container = document.getElementById('employee-cards');
    
    if (employees.length === 0) {
        renderEmptyState(container, {
            icon: 'users',
            title: 'No employees yet',
            description: 'Once an administrator adds employees, their cards will appear here.',
            action: isAdminAuthenticated
                ? { label: 'Go to Employee Management', variant: 'btn-ghost', onClick: "showTab('admin'); setTimeout(()=>showAdminSection('employees'),100);" }
                : null
        });
        return;
    }

    // Build summaries once — used for chip counts AND filtering AND rendering.
    const allSummaries = employees.map(summariseEmployee);
    updateFilterChipCounts(allSummaries);

    // Apply filter + search, then sort.
    const filtered = allSummaries
        .filter(s => passesFilter(s, EMP_VIEW_STATE.filter))
        .filter(s => passesSearch(s, EMP_VIEW_STATE.search));
    const visible = sortSummaries(filtered, EMP_VIEW_STATE.sort);

    if (visible.length === 0) {
        // Empty results state — context-aware
        if (EMP_VIEW_STATE.search) {
            renderEmptyState(container, {
                icon: 'search',
                title: 'No matches',
                description: `No employees match "${EMP_VIEW_STATE.search}". Try a different search or clear the active filter.`
            });
        } else {
            const filterLabels = {
                'has-pending':  'with pending requests',
                'on-leave-now': 'on leave today',
                'low-days':     `with ${EMP_LOW_DAYS_THRESHOLD} or fewer days remaining`
            };
            renderEmptyState(container, {
                icon: 'check',
                tone: 'success',
                title: 'No matches for this filter',
                description: `No employees ${filterLabels[EMP_VIEW_STATE.filter] || 'match'}. Try the "All" filter to see everyone.`
            });
        }
        return;
    }
    
    container.innerHTML = visible.map(({ employee, remaining, pending, reqs, nextLeave }) => {
        // Find next upcoming holiday/leave label
        const today = new Date().toISOString().split('T')[0];
        let nextLeaveText = 'No upcoming leave';
        let nextLeaveClass = 'none';

        if (nextLeave) {
            const daysUntil = Math.ceil((new Date(nextLeave.startDate) - new Date(today)) / (1000 * 60 * 60 * 24));
            const leaveType = nextLeave.requestType || 'holiday';
            const typeText = leaveType === 'holiday' ? 'Holiday' :
                           leaveType === 'sick' ? 'Sick leave' : 'Bereavement';
            
            if (daysUntil === 0) {
                nextLeaveText = `${typeText} starts today`;
            } else if (daysUntil === 1) {
                nextLeaveText = `${typeText} starts tomorrow`;
            } else {
                nextLeaveText = `Next ${leaveType} in ${daysUntil} days`;
            }
            nextLeaveClass = '';
        }
        
        return `
            <div class="employee-card-selector" onclick="selectEmployee(${employee.id})" data-employee-id="${employee.id}">
                <div class="employee-card-name">${employee.name}</div>
                <div class="employee-card-stats">
                    <div class="employee-stat">
                        <strong>${remaining}</strong> days left
                    </div>
                    <div class="employee-stat">
                        <strong>${pending.length}</strong> pending
                    </div>
                    <div class="employee-stat">
                        <strong>${employee.totalAllowance}</strong> total allowance
                    </div>
                    <div class="employee-stat">
                        <strong>${reqs.length}</strong> total requests
                    </div>
                </div>
                <div class="employee-next-holiday ${nextLeaveClass}">
                    ${nextLeaveText}
                </div>
            </div>
        `;
    }).join('');
}

// Update the selectEmployee function to calculate remaining days dynamically
function selectEmployee(employeeId) {
    // Remove previous selection
    document.querySelectorAll('.employee-card-selector').forEach(card => {
        card.classList.remove('selected');
    });

    // Add selection to clicked card
    document.querySelector(`[data-employee-id="${employeeId}"]`).classList.add('selected');

    // Update current employee
    currentEmployee = employees.find(emp => emp.id === employeeId);

    if (currentEmployee) {
        document.getElementById('employee-info').classList.remove('hidden');
        
        // Calculate remaining days dynamically
        const employeeRequests = holidayRequests.filter(req => req.employeeId === employeeId);
        const approvedRequests = employeeRequests.filter(req => req.status === 'approved');
        
        // Only count days from approved requests that deduct from allowance
        const usedDays = approvedRequests.reduce((sum, req) => {
            return sum + ((req.deductFromHoliday || req.requestType === 'holiday') ? req.days : 0);
        }, 0);
        
        const remainingDays = currentEmployee.totalAllowance - usedDays;
        
        // Update the display
        document.getElementById('remaining-days').textContent = remainingDays;
        document.getElementById('total-days').textContent = currentEmployee.totalAllowance;
        document.getElementById('employee-name').textContent = currentEmployee.name;
        
        loadEmployeeRequests();

        // 👉 Smooth scroll to the allowance section
        document.getElementById('employee-info').scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    } else {
        document.getElementById('employee-info').classList.add('hidden');
    }
}


// New function to handle request type changes
function updateRequestTypeOptions() {
    const requestType = document.getElementById('request-type').value;
    const deductToggleContainer = document.getElementById('deduct-toggle-container');
    const deductCheckbox = document.getElementById('deduct-from-holiday');

    if (requestType === 'sick' || requestType === 'bereavement') {
        deductToggleContainer.style.display = 'block';
    } else {
        deductToggleContainer.style.display = 'none';
        deductCheckbox.checked = false;
    }

    // Add this line to force recalculate after changing request type:
    updateDaysPreview();
}

// Block Booking Functions
function toggleBlockBooking() {
    const blockBookingToggle = document.getElementById('block-booking-toggle');
    const dateRangeInputs = document.getElementById('date-range-inputs');
    const blockBookingCalendar = document.getElementById('block-booking-calendar');
    const halfDayToggle = document.getElementById('half-day-toggle');
    const halfDayOptions = document.getElementById('half-day-options');
    const halfDayContainer = halfDayToggle.closest('.form-group');
    
    isBlockBooking = blockBookingToggle.checked;
    
    if (isBlockBooking) {
        // Hide date range inputs and show block booking calendar
        dateRangeInputs.classList.add('hidden');
        blockBookingCalendar.classList.remove('hidden');
        
        // Hide and disable half day for block booking
        halfDayToggle.checked = false;
        halfDayToggle.disabled = true;
        halfDayOptions.classList.add('hidden');
        
        // Replace half-day checkbox with explanatory text
        halfDayContainer.innerHTML = `
            <div style="background: #e3f2fd; border: 1px solid #bbdefb; border-radius: 6px; padding: 12px; margin-bottom: 10px;">
                <p style="margin: 0; font-size: 14px; color: #1565c0;">
                    <strong>Note:</strong> Half-day requests are not available in block booking mode. 
                    If you need a half-day within your selection, please submit separate requests.
                </p>
            </div>
        `;
        
        // Initialize block calendar
        blockCalendarDate = new Date();
        selectedDates = [];
        renderBlockCalendar();
        updateSelectedDatesSummary();
        
        // Clear validation requirements on hidden inputs
        document.getElementById('start-date').removeAttribute('required');
        document.getElementById('end-date').removeAttribute('required');
    } else {
        // Show date range inputs and hide block booking calendar
        dateRangeInputs.classList.remove('hidden');
        blockBookingCalendar.classList.add('hidden');
        
        // Restore original half-day checkbox HTML
        halfDayContainer.innerHTML = `
            <div class="half-day-container">
                <label class="checkbox-label">
                    <input type="checkbox" id="half-day-toggle" onchange="toggleHalfDay()">
                    <span class="checkbox-custom"></span>
                    Half Day Request
                </label>
            </div>
        `;
        
        // Restore validation requirements
        document.getElementById('start-date').setAttribute('required', '');
        document.getElementById('end-date').setAttribute('required', '');
        
        // Clear selected dates
        selectedDates = [];
    }
    
    updateDaysPreview();
}

function renderBlockCalendar() {
    const year = blockCalendarDate.getFullYear();
    const month = blockCalendarDate.getMonth();
    
    // Update calendar title
    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    document.getElementById('block-calendar-title').textContent = `${monthNames[month]} ${year}`;
    
    // Create calendar grid
    const grid = document.getElementById('block-calendar-grid');
    grid.innerHTML = '';
    
    // Day headers
    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayHeaders.forEach(day => {
        const dayHeader = document.createElement('div');
        dayHeader.className = 'block-calendar-day-header';
        dayHeader.textContent = day;
        grid.appendChild(dayHeader);
    });
    
    // Get first day of month and number of days
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    
    // Generate calendar days
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < 42; i++) { // 6 weeks
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        
        const dayElement = document.createElement('div');
        dayElement.className = 'block-calendar-day';
        dayElement.textContent = date.getDate();
        
        const dateStr = formatDateForComparison(date);
        const dayOfWeek = date.getDay();
        
        // Add classes based on date properties
        if (date.getMonth() !== month) {
            dayElement.classList.add('other-month');
        } else if (date < today) {
            dayElement.classList.add('past-date');
        } else {
            // Add weekend class for styling
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                dayElement.classList.add('weekend');
            }
            
            // Check if date is today
            if (date.getTime() === today.getTime()) {
                dayElement.classList.add('today');
            }
            
            // Check if this date is already booked by this employee
            const alreadyBooked = currentEmployee && getEmployeeOverlappingDates(currentEmployee.id, [dateStr]).length > 0;
            if (alreadyBooked) {
                dayElement.classList.add('already-booked');
                dayElement.title = 'Already booked';
            }
            
            // Check if date is selected
            if (selectedDates.includes(dateStr)) {
                dayElement.classList.add('selected');
            }
            
            // Add click handler for selectable dates (but not already booked ones)
            if (!alreadyBooked) {
                dayElement.addEventListener('click', () => toggleDateSelection(dateStr));
            }
        }
        
        grid.appendChild(dayElement);
    }
}

function changeBlockMonth(direction) {
    blockCalendarDate.setMonth(blockCalendarDate.getMonth() + direction);
    renderBlockCalendar();
}

function formatDateForComparison(date) {
    return date.getFullYear() + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0');
}

function toggleDateSelection(dateStr) {
    const index = selectedDates.indexOf(dateStr);
    
    if (index > -1) {
        // Remove date
        selectedDates.splice(index, 1);
    } else {
        // Add date
        selectedDates.push(dateStr);
    }
    
    // Sort dates
    selectedDates.sort();
    
    // Update calendar display
    renderBlockCalendar();
    
    // Update summary
    updateSelectedDatesSummary();
    
    // Update days preview
    updateDaysPreview();
}

function updateSelectedDatesSummary() {
    const summaryContainer = document.getElementById('selected-dates-summary');
    const datesList = document.getElementById('selected-dates-list');
    const groupsPreview = document.getElementById('booking-groups-preview');
    
    if (selectedDates.length === 0) {
        summaryContainer.classList.add('hidden');
        return;
    }
    
    summaryContainer.classList.remove('hidden');
    
    // Update selected dates list
    datesList.innerHTML = selectedDates.map(dateStr => {
        const date = new Date(dateStr);
        const formattedDate = date.toLocaleDateString('en-GB', { 
            day: 'numeric', 
            month: 'short' 
        });
        return `<span class="selected-date-tag">${formattedDate}</span>`;
    }).join('');
    
    // Group consecutive dates and show preview
    const groups = groupConsecutiveDates(selectedDates);
    
    groupsPreview.innerHTML = `
        <h6 style="margin: 0 0 10px 0; color: #333; font-weight: 500;">
            This will create ${groups.length} separate request${groups.length !== 1 ? 's' : ''}:
        </h6>
        ${groups.map((group, index) => {
            const startDate = new Date(group.startDate);
            const endDate = new Date(group.endDate);
            const days = group.dates.length;
            
            const startFormatted = startDate.toLocaleDateString('en-GB', { 
                day: 'numeric', 
                month: 'short' 
            });
            const endFormatted = endDate.toLocaleDateString('en-GB', { 
                day: 'numeric', 
                month: 'short' 
            });
            
            const dateRange = group.startDate === group.endDate ? 
                startFormatted : 
                `${startFormatted} - ${endFormatted}`;
            
            return `
                <div class="booking-group">
                    <div class="booking-group-header">Request ${index + 1}: ${dateRange}</div>
                    <div class="booking-group-details">${days} day${days !== 1 ? 's' : ''}</div>
                </div>
            `;
        }).join('')}
        
    `;
}

function groupConsecutiveDates(dates) {
    if (dates.length === 0) return [];
    
    const groups = [];
    let currentGroup = {
        startDate: dates[0],
        endDate: dates[0],
        dates: [dates[0]]
    };
    
    for (let i = 1; i < dates.length; i++) {
        const currentDate = new Date(dates[i]);
        const lastDate = new Date(currentGroup.endDate);
        
        // Calculate difference in days, considering only weekdays
        const diffInDays = Math.ceil((currentDate - lastDate) / (1000 * 60 * 60 * 24));
        
        // Check if dates are consecutive (accounting for weekends)
        let isConsecutive = false;
        if (diffInDays === 1) {
            isConsecutive = true;
        } else if (diffInDays <= 3) {
            // Check if the gap is only weekends
            const tempDate = new Date(lastDate);
            tempDate.setDate(tempDate.getDate() + 1);
            let allWeekends = true;
            
            while (tempDate < currentDate) {
                const dayOfWeek = tempDate.getDay();
                if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday or Saturday
                    allWeekends = false;
                    break;
                }
                tempDate.setDate(tempDate.getDate() + 1);
            }
            
            isConsecutive = allWeekends;
        }
        
        if (isConsecutive) {
            // Add to current group
            currentGroup.endDate = dates[i];
            currentGroup.dates.push(dates[i]);
        } else {
            // Start new group
            groups.push(currentGroup);
            currentGroup = {
                startDate: dates[i],
                endDate: dates[i],
                dates: [dates[i]]
            };
        }
    }
    
    // Add the last group
    groups.push(currentGroup);
    
    return groups;
}

function calculateDays(startDate, endDate, isHalfDay = false, employeeId = null) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // If it's a half day and same date, return 0.5
    if (isHalfDay && startDate === endDate) {
        return 0.5;
    }
    
    // Determine if this employee has Saturday deductions included in their contract
    let includeSaturdayDeduction = false;
    if (employeeId) {
        const employee = employees.find(emp => emp.id === employeeId);
        includeSaturdayDeduction = employee ? employee.includeSaturdayDeduction : false;
    }
    
    let days = 0;
    const current = new Date(start);
    
    // Loop through each day between start and end dates
    while (current <= end) {
        const dayOfWeek = current.getDay();
        
        // Always skip Sundays (0)
        // Skip Saturdays (6) only if employee doesn't have Saturday deduction in contract
        if (dayOfWeek !== 0 && (includeSaturdayDeduction || dayOfWeek !== 6)) {
            days++;
        }
        current.setDate(current.getDate() + 1);
    }
    
    return days;
}

function toggleHalfDay() {
    const halfDayToggle = document.getElementById('half-day-toggle');
    const halfDayOptions = document.getElementById('half-day-options');
    const endDateInput = document.getElementById('end-date');
    const startDateInput = document.getElementById('start-date');
    
    if (halfDayToggle.checked) {
        halfDayOptions.classList.remove('hidden');
        // For half days, end date should match start date
        if (startDateInput.value) {
            endDateInput.value = startDateInput.value;
        }
        endDateInput.disabled = true;
    } else {
        halfDayOptions.classList.add('hidden');
        endDateInput.disabled = false;
    }
    updateDaysPreview();
}

function updateDaysPreview() {
    const calculatedDaysSpan = document.getElementById('calculated-days');
    const requestType = document.getElementById('request-type').value;
    const deductFromHoliday = document.getElementById('deduct-from-holiday').checked;
    
    let totalDays = 0;
    
    if (isBlockBooking) {
        // Calculate total days from selected dates
        if (selectedDates.length > 0 && currentEmployee) {
            selectedDates.forEach(dateStr => {
                const date = new Date(dateStr);
                const dayOfWeek = date.getDay();
                
                // Get employee info to check Saturday deduction setting
                const includeSaturdayDeduction = currentEmployee.includeSaturdayDeduction;
                
                // Count weekdays (exclude Sundays, and Saturdays unless employee has Saturday deduction)
                if (dayOfWeek !== 0 && (includeSaturdayDeduction || dayOfWeek !== 6)) {
                    totalDays++;
                }
            });
        }
    } else {
        // Original calculation for date range
        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;
        const isHalfDay = document.getElementById('half-day-toggle').checked;
        
        if (startDate && endDate && currentEmployee) {
            totalDays = calculateDays(startDate, endDate, isHalfDay, currentEmployee.id);
        }
    }
    
    // Only show days to be deducted if it's a holiday or if deduct checkbox is checked
    if (requestType === 'holiday' || deductFromHoliday) {
        calculatedDaysSpan.textContent = totalDays;
    } else {
        calculatedDaysSpan.textContent = '0';
    }
}

// Check if the current employee already has existing (non-cancelled) bookings overlapping the given dates
function getEmployeeOverlappingDates(employeeId, datesToCheck) {
    // Get all active requests for this employee (pending or approved)
    const existingRequests = holidayRequests.filter(req =>
        req.employeeId === employeeId &&
        req.status !== 'declined' &&
        req.status !== 'cancelled'
    );

    const overlapping = new Set();

    datesToCheck.forEach(dateStr => {
        existingRequests.forEach(req => {
            if (req.isBlockBooking && req.selectedDates) {
                if (req.selectedDates.includes(dateStr)) {
                    overlapping.add(dateStr);
                }
            } else {
                const reqStart = new Date(req.startDate);
                const reqEnd = new Date(req.endDate);
                const check = new Date(dateStr);
                if (check >= reqStart && check <= reqEnd) {
                    overlapping.add(dateStr);
                }
            }
        });
    });

    return Array.from(overlapping).sort();
}

// Build a list of all dates in a start→end range as YYYY-MM-DD strings
function getDateRange(startDate, endDate) {
    const dates = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    while (current <= end) {
        dates.push(formatDateForComparison(current));
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

async function submitHolidayRequest(event) {
    event.preventDefault();
    
    if (!currentEmployee) return;
    
    const requestType = document.getElementById('request-type').value;
    const reason = document.getElementById('reason').value;
    const deductFromHoliday = document.getElementById('deduct-from-holiday').checked;
    const shouldDeductDays = requestType === 'holiday' || deductFromHoliday;
    
    if (isBlockBooking) {
        // Handle block booking submission
        if (selectedDates.length === 0) {
            toast.warning('Please select at least one date to continue.');
            return;
        }
        
        // Check for duplicate/overlapping bookings for this employee
        const overlappingDates = getEmployeeOverlappingDates(currentEmployee.id, selectedDates);
        if (overlappingDates.length > 0) {
            const formattedDates = overlappingDates.map(d => {
                const date = new Date(d);
                return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
            }).join(', ');
            toast.warning(`You already have bookings on: ${formattedDates}. Please remove those dates and try again.`, { title: 'Date conflict', duration: 8000 });
            return;
        }

        const groups = groupConsecutiveDates(selectedDates);
        const remainingDays = currentEmployee.totalAllowance - currentEmployee.usedDays;
        
        // Calculate total days needed
        let totalDaysNeeded = 0;
        selectedDates.forEach(dateStr => {
            const date = new Date(dateStr);
            const dayOfWeek = date.getDay();
            const includeSaturdayDeduction = currentEmployee.includeSaturdayDeduction;
            
            if (dayOfWeek !== 0 && (includeSaturdayDeduction || dayOfWeek !== 6)) {
                totalDaysNeeded++;
            }
        });
        
        // Check if employee has enough days
        if (shouldDeductDays && totalDaysNeeded > remainingDays) {
            toast.warning(`You need ${totalDaysNeeded} days but only have ${remainingDays} remaining.`, { title: 'Insufficient allowance', duration: 7000 });
            return;
        }
        
        // Sick leave auto-approves — require authoriser for audit trail
        let sickAuthoriser = null;
        if (requestType === 'sick') {
            sickAuthoriser = promptAuthoriser(`record this sick leave for ${currentEmployee.name}`);
            if (!sickAuthoriser) return;
        }

        // Create multiple requests for each group
        const newRequests = [];
        for (const group of groups) {
            const groupDays = group.dates.length; // This will be recalculated properly below
            
            // Calculate actual working days for this group
            let workingDays = 0;
            group.dates.forEach(dateStr => {
                const date = new Date(dateStr);
                const dayOfWeek = date.getDay();
                const includeSaturdayDeduction = currentEmployee.includeSaturdayDeduction;
                
                if (dayOfWeek !== 0 && (includeSaturdayDeduction || dayOfWeek !== 6)) {
                    workingDays++;
                }
            });
            
            // Auto-approve sick leave requests (employee is already off sick)
            // Holiday and bereavement requests still require approval
            const initialStatus = requestType === 'sick' ? 'approved' : 'pending';
            
            const newRequest = {
                id: nextRequestId++,
                employeeId: currentEmployee.id,
                employeeName: currentEmployee.name,
                startDate: group.startDate,
                endDate: group.endDate,
                days: workingDays,
                isHalfDay: false,
                halfDayPeriod: null,
                reason,
                status: initialStatus,
                submittedDate: new Date().toISOString().split('T')[0],
                requestType: requestType,
                deductFromHoliday: shouldDeductDays,
                isBlockBooking: true,
                selectedDates: group.dates
            };

            // Stamp authoriser for sick leave (auto-approved)
            if (requestType === 'sick' && sickAuthoriser) {
                newRequest.approvedBy = sickAuthoriser;
                newRequest.approvedDate = new Date().toISOString().split('T')[0];
            }

            newRequests.push(newRequest);
        }
        
        // Add all requests
        holidayRequests.push(...newRequests);
        await saveHolidayRequests();
        
        // Send email notification to admins for each request in the block
        for (const request of newRequests) {
            await sendEmailNotification(currentEmployee, request, 'new_request');
        }
        
        const typeText = requestType === 'holiday' ? 'Holiday' : 
                        requestType === 'sick' ? 'Sick Leave' : 'Bereavement Leave';
        
        // Different message for sick leave (auto-approved)
        if (requestType === 'sick') {
            toast.success(`${typeText} recorded · ${groups.length} request${groups.length !== 1 ? 's' : ''} created. Admins notified.`, { title: 'Auto-approved', duration: 6000 });
        } else {
            toast.success(`${typeText} block booking submitted · ${groups.length} request${groups.length !== 1 ? 's' : ''} pending approval.`, { title: 'Submitted', duration: 5000 });
        }
        
        // Reset block booking
        selectedDates = [];
        document.getElementById('block-booking-toggle').checked = false;
        toggleBlockBooking();
        
    } else {
        // Handle regular single date range submission (existing code)
        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;
        const isHalfDay = document.getElementById('half-day-toggle').checked;
        const halfDayPeriod = isHalfDay ? document.getElementById('half-day-period').value : null;
        
        const days = calculateDays(startDate, endDate, isHalfDay, currentEmployee.id);
        const remainingDays = currentEmployee.totalAllowance - currentEmployee.usedDays;
        
        // Check if employee has enough days only if it's a holiday or if deducting from allowance
        if (shouldDeductDays && days > remainingDays) {
            toast.warning(`You only have ${remainingDays} day${remainingDays === 1 ? '' : 's'} remaining.`, { title: 'Insufficient allowance', duration: 6000 });
            return;
        }
        
        // Check for duplicate/overlapping bookings for this employee
        const requestDates = getDateRange(startDate, isHalfDay ? startDate : endDate);
        const overlappingDates = getEmployeeOverlappingDates(currentEmployee.id, requestDates);
        if (overlappingDates.length > 0) {
            const formattedDates = overlappingDates.map(d => {
                const date = new Date(d);
                return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
            }).join(', ');
            toast.warning(`You already have bookings on: ${formattedDates}. Please choose different dates.`, { title: 'Date conflict', duration: 8000 });
            return;
        }
        
        // Auto-approve sick leave requests (employee is already off sick)
        // Holiday and bereavement requests still require approval
        const initialStatus = requestType === 'sick' ? 'approved' : 'pending';

        // Sick leave auto-approves — require authoriser for audit trail
        let sickAuthoriserSingle = null;
        if (requestType === 'sick') {
            sickAuthoriserSingle = promptAuthoriser(`record this sick leave for ${currentEmployee.name}`);
            if (!sickAuthoriserSingle) return;
        }

        const newRequest = {
            id: nextRequestId++,
            employeeId: currentEmployee.id,
            employeeName: currentEmployee.name,
            startDate,
            endDate: isHalfDay ? startDate : endDate,
            days,
            isHalfDay,
            halfDayPeriod,
            reason,
            status: initialStatus,
            submittedDate: new Date().toISOString().split('T')[0],
            requestType: requestType,
            deductFromHoliday: shouldDeductDays
        };

        // Stamp authoriser for sick leave (auto-approved)
        if (requestType === 'sick' && sickAuthoriserSingle) {
            newRequest.approvedBy = sickAuthoriserSingle;
            newRequest.approvedDate = new Date().toISOString().split('T')[0];
        }
        
        holidayRequests.push(newRequest);
        await saveHolidayRequests();
        
        // Send email notification to admins
        // For sick leave, this is informational (already approved)
        // For holidays/bereavement, this is a request for approval
        await sendEmailNotification(currentEmployee, newRequest, 'new_request');
        
        const typeText = requestType === 'holiday' ? 'Holiday' : 
                        requestType === 'sick' ? 'Sick Leave' : 'Bereavement Leave';
        
        // Different message for sick leave (auto-approved)
        if (requestType === 'sick') {
            toast.success(`${typeText} recorded · admins notified.`, { title: 'Auto-approved', duration: 5000 });
        } else {
            toast.success(`${typeText} submitted · pending approval.`, { title: 'Submitted' });
        }
        
        // Reset form
        document.getElementById('holiday-form').reset();
        document.getElementById('half-day-toggle').checked = false;
        document.getElementById('half-day-options').classList.add('hidden');
        document.getElementById('end-date').disabled = false;
        document.getElementById('deduct-toggle-container').style.display = 'none';
    }
    
    updateDaysPreview();
    
    // Refresh displays
    loadEmployeeRequests();
    populateEmployeeCards();
    renderCalendar();
    updatePendingBadge(); // Update badge count
}

function loadEmployeeRequests() {
    if (!currentEmployee) return;
    
    const container = document.getElementById('employee-requests');
    const requests = holidayRequests.filter(req => req.employeeId === currentEmployee.id);
    
    if (requests.length === 0) {
        renderEmptyState(container, {
            icon: 'calendar',
            title: 'No requests yet',
            description: `${currentEmployee.name} hasn't made any holiday requests this year. Use the form above to submit one.`
        });
        return;
    }
    
    container.innerHTML = requests.map(request => {
        const dateRange = request.startDate === request.endDate ? 
            request.startDate : 
            `${request.startDate} to ${request.endDate}`;
        
        let dayText;
        if (request.isHalfDay) {
            dayText = `${request.days} day (${request.halfDayPeriod} half-day)`;
        } else if (request.isBlockBooking && request.selectedDates) {
            dayText = `${request.days} days (Block booking: ${request.selectedDates.length} selected dates)`;
        } else {
            dayText = `${request.days} days`;
        }
        
        const requestType = request.requestType || 'holiday';
        const typeText = requestType === 'holiday' ? 'Holiday' : 
                        requestType === 'sick' ? 'Sick Leave' : 'Bereavement Leave';
        
        const deductText = request.deductFromHoliday ? ' (deducted from holiday allowance)' : '';
        
        // Add block booking details if applicable
        let blockBookingDetails = '';
        if (request.isBlockBooking && request.selectedDates) {
            const formattedDates = request.selectedDates.map(dateStr => {
                const date = new Date(dateStr);
                return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            }).join(', ');
            
            blockBookingDetails = `<p><strong>Selected Dates:</strong> ${formattedDates}</p>`;
        }

        // Audit stamp showing who authorised / rejected / cancelled
        const auditStamp = buildAuditStamp(request);

        return `
            <div class="holiday-request ${request.status}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div style="flex: 1;">
                        <h4>${dateRange} (${dayText})</h4>
                        <p><strong>Type:</strong> ${typeText}${deductText}</p>
                        ${blockBookingDetails}
                        <p><strong>Reason:</strong> ${request.reason || 'Not specified'}</p>
                        <p><strong>Submitted:</strong> ${request.submittedDate}</p>
                        ${auditStamp}
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 10px; margin-left: 15px;">
                        <span class="status-badge status-${request.status}">${request.status}</span>
                        ${request.status === 'pending' || request.status === 'approved' ? 
                            `<button class="btn-cancel btn-small" onclick="cancelHolidayRequest(${request.id})">Cancel</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function cancelHolidayRequest(requestId) {
    const request = holidayRequests.find(req => req.id === requestId);
    if (!request) return;

    const ok = await confirmDialog({
        title: 'Cancel this request?',
        message: `${request.employeeName}'s ${request.requestType || 'holiday'} request will be cancelled. Any days already deducted will be returned to their allowance.`,
        confirmLabel: 'Cancel request',
        cancelLabel: 'Keep it',
        danger: true
    });
    if (!ok) return;

    const authoriser = promptAuthoriser(`cancel this ${request.requestType || 'holiday'} request for ${request.employeeName}`);
    if (!authoriser) return;

    const employee = employees.find(emp => emp.id === request.employeeId);
    const wasApprovedAndDeducted = request.status === 'approved' &&
        (request.requestType === 'holiday' || request.deductFromHoliday) && employee;

    // ----- Snapshot -----
    const snapshot = {
        request: { ...request },
        employee: wasApprovedAndDeducted ? { ...employee } : null
    };

    // ----- Optimistic apply -----
    if (wasApprovedAndDeducted) employee.usedDays -= request.days;
    request.status = 'cancelled';
    request.cancelledDate = new Date().toISOString().split('T')[0];
    request.cancelledBy = authoriser;

    if (currentEmployee && currentEmployee.id === request.employeeId) {
        loadEmployeeRequests();
    }
    refreshAdminViews();
    renderCalendar();
    updatePendingBadge();

    const loading = toast.loading(`Cancelling ${request.employeeName}'s request…`);

    try {
        if (wasApprovedAndDeducted) await saveEmployees();
        await saveHolidayRequests();
        if (employee) await sendEmailNotification(employee, request, 'cancelled');
        loading.success('Request cancelled');
    } catch (err) {
        Object.assign(request, snapshot.request);
        if (snapshot.employee && employee) Object.assign(employee, snapshot.employee);
        if (currentEmployee && currentEmployee.id === request.employeeId) {
            loadEmployeeRequests();
        }
        refreshAdminViews();
        renderCalendar();
        updatePendingBadge();
        loading.error(`Couldn't cancel — ${err.message || 'save failed'}`, {
            actions: [{ label: 'Retry', primary: true, onClick: () => cancelHolidayRequest(requestId) }]
        });
    }
}

// Calendar functions
function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    // Update calendar title
    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    document.getElementById('calendar-title').textContent = `${monthNames[month]} ${year}`;
    
    // Get all non-cancelled requests for this month
    const allRequests = holidayRequests.filter(req => req.status !== 'cancelled');

    // Read holiday display toggles (default to true if not yet rendered)
    const showBank   = document.getElementById('show-bank-holidays')?.checked ?? true;
    const showSchool = document.getElementById('show-school-holidays')?.checked ?? true;

    // Create calendar grid
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';
    
    // Day headers
    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayHeaders.forEach(day => {
        const dayHeader = document.createElement('div');
        dayHeader.className = 'calendar-day-header';
        dayHeader.textContent = day;
        grid.appendChild(dayHeader);
    });
    
    // Get first day of month and number of days
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    
    // Generate calendar days
    const today = new Date();
    const currentDateStr = today.toISOString().split('T')[0];
    
    for (let i = 0; i < 42; i++) { // 6 weeks
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        
        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day';
        
        const dateStr = date.getFullYear() + '-' +
            String(date.getMonth() + 1).padStart(2, '0') + '-' +
            String(date.getDate()).padStart(2, '0');
        
        // Add day number
        const dayNumber = document.createElement('div');
        dayNumber.className = 'calendar-day-number';
        dayNumber.textContent = date.getDate();
        dayElement.appendChild(dayNumber);
        
        // Check if date is in current month
        if (date.getMonth() !== month) {
            dayElement.classList.add('other-month');
        }
        
        // Check if date is today
        if (dateStr === currentDateStr) {
            dayElement.classList.add('today');
        }

        // Look up Scotland / school holidays for this day
        const holidaysOnDay = getHolidaysOnDate(dateStr).filter(h => {
            if (h.type === 'bank') return showBank;
            return showSchool; // school + inservice
        });

        if (holidaysOnDay.length > 0) {
            // Add classes for visual styling
            holidaysOnDay.forEach(h => {
                if (h.type === 'bank')      dayElement.classList.add('bank-holiday');
                if (h.type === 'school' ||
                    h.type === 'local')     dayElement.classList.add('school-holiday');
                if (h.type === 'inservice') dayElement.classList.add('inservice-day');
            });

            // Add small badges
            const badgeContainer = document.createElement('div');
            badgeContainer.className = 'holiday-badges';
            holidaysOnDay.forEach(h => {
                const badge = document.createElement('span');
                const cls = h.type === 'bank' ? 'bank'
                          : h.type === 'inservice' ? 'inservice'
                          : 'school';
                badge.className = `holiday-badge ${cls}`;
                // Short label for badge, full name in tooltip
                badge.textContent = shortHolidayLabel(h);
                badge.title = h.name;
                badgeContainer.appendChild(badge);
            });
            dayElement.appendChild(badgeContainer);
        }

        // Check for requests on this date
        const requestsOnDate = getRequestsOnDate(dateStr, allRequests);
        if (requestsOnDate.length > 0) {
            dayElement.classList.add('has-holiday');
            
            // Create employee name list container
            const employeeList = document.createElement('div');
            employeeList.className = 'employee-name-list';
            
            // Add employee names
            requestsOnDate.forEach(request => {
                const employeeName = document.createElement('span');
                employeeName.className = `employee-name-item ${request.status}`;
                const typeIcon = request.requestType === 'sick' ? '🏥 ' : 
                               request.requestType === 'bereavement' ? '🕊️ ' : '🏖️ ';
                employeeName.textContent = typeIcon + request.employeeName;
                employeeName.title = `${request.employeeName} - ${request.reason || 'No reason specified'}`;
                employeeList.appendChild(employeeName);
            });
            
            dayElement.appendChild(employeeList);
        }

        // Click handler — show popover for any day with employee requests OR public/school holidays
        if (requestsOnDate.length > 0 || holidaysOnDay.length > 0) {
            dayElement.addEventListener('click', (e) => {
                e.stopPropagation();
                showRequestPopover(e.currentTarget, dateStr, requestsOnDate, holidaysOnDay);
            });
        }

        grid.appendChild(dayElement);
    }
}

// Shorten holiday name for the day badge (full name still in tooltip + popover)
function shortHolidayLabel(h) {
    if (h.type === 'inservice') return 'In-service';
    if (h.type === 'bank') {
        if (h.name.includes("New Year"))         return "New Year";
        if (h.name.includes('2nd January'))      return '2 Jan';
        if (h.name.includes('Good Friday'))      return 'Good Fri';
        if (h.name.includes('Early May'))        return 'May Day';
        if (h.name.includes('Spring'))           return 'Spring BH';
        if (h.name.includes('Summer'))           return 'Summer BH';
        if (h.name.includes('Andrew'))           return "St Andrew's";
        if (h.name.includes('Christmas'))        return 'Christmas';
        if (h.name.includes('Boxing'))           return 'Boxing Day';
        if (h.name.includes('FIFA'))             return 'World Cup BH';
        return 'Bank holiday';
    }
    // school / local
    if (h.name.includes('Christmas'))            return 'Christmas';
    if (h.name.includes('Easter'))               return 'Easter';
    if (h.name.includes('Summer'))               return 'Summer';
    if (h.name.includes('October'))              return 'October';
    if (h.name.includes('Ayr Gold Cup'))         return 'Ayr Gold Cup';
    if (h.name.includes('May Day'))              return 'May Day';
    if (h.name.includes('Local'))                return 'Local hol';
    return 'School hol';
}

function getRequestsOnDate(dateStr, requests) {
    return requests.filter(request => {
        // Handle block booking requests
        if (request.isBlockBooking && request.selectedDates) {
            return request.selectedDates.includes(dateStr);
        }
        
        // Handle regular date range requests
        const start = new Date(request.startDate);
        const end = new Date(request.endDate);
        const checkDate = new Date(dateStr);
        
        if (checkDate >= start && checkDate <= end) {
            const dayOfWeek = checkDate.getDay();
            
            // Get employee info to check if they have Saturday deduction in contract
            const employee = employees.find(emp => emp.id === request.employeeId);
            const includeSaturdayDeduction = employee ? employee.includeSaturdayDeduction : false;
            
            // Always exclude Sundays, exclude Saturdays only if employee doesn't have Saturday deduction
            return dayOfWeek !== 0 && (includeSaturdayDeduction || dayOfWeek !== 6);
        }
        return false;
    });
}

function showRequestPopover(element, dateStr, requests, holidays = []) {
    closePopover();
    
    const popover = document.createElement('div');
    popover.className = 'popover';
    
    const formattedDate = new Date(dateStr).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    let content = `<div class="popover-header">${formattedDate}</div>`;

    // Public / school holidays first
    holidays.forEach(h => {
        const cls = h.type === 'bank' ? 'bank'
                  : h.type === 'inservice' ? 'inservice'
                  : 'school';
        const tag = h.type === 'bank' ? 'Bank Holiday'
                  : h.type === 'inservice' ? 'In-Service Day'
                  : 'School Holiday';
        content += `
            <div class="popover-holiday ${cls}">
                <span class="holiday-tag">${tag}</span>
                <strong>${h.name}</strong>
            </div>
        `;
    });

    requests.forEach(request => {
        const startDate = new Date(request.startDate).toLocaleDateString();
        const endDate = new Date(request.endDate).toLocaleDateString();
        let dateRange = startDate === endDate ? startDate : `${startDate} - ${endDate}`;
        
        let dayText;
        if (request.isHalfDay) {
            dayText = `${request.days} day (${request.halfDayPeriod} half-day)`;
        } else if (request.isBlockBooking && request.selectedDates) {
            dayText = `${request.days} days (Block booking)`;
            // For block bookings, show the specific date instead of range
            dateRange = new Date(dateStr).toLocaleDateString();
        } else {
            dayText = `${request.days} days`;
        }
        
        const requestType = request.requestType || 'holiday';
        const typeText = requestType === 'holiday' ? 'Holiday' : 
                        requestType === 'sick' ? 'Sick Leave' : 'Bereavement Leave';
        
        content += `
            <div class="popover-employee">
                <strong>${request.employeeName}</strong><br>
                <em>Type: ${typeText}</em><br>
                <em>Status: ${request.status}</em><br>
                ${dateRange} (${dayText})<br>
                <em>${request.reason || 'No reason specified'}</em>
                ${request.deductFromHoliday && requestType !== 'holiday' ? '<br><em>(Deducted from holiday allowance)</em>' : ''}
                ${request.isBlockBooking ? '<br><em>(Part of block booking)</em>' : ''}
            </div>
        `;
    });
    
    popover.innerHTML = content;
    document.body.appendChild(popover);

    // --- Updated positioning logic ---
    const rect = element.getBoundingClientRect();
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    // Default: below the clicked element
    let left = rect.left + scrollX;
    let top  = rect.bottom + scrollY + gap;

    // Measure the popover
    const { width: popW, height: popH } = popover.getBoundingClientRect();

    // Clamp right edge
    if (left + popW > scrollX + vw - gap) {
        left = Math.max(scrollX + gap, scrollX + vw - popW - gap);
    }

    // If it doesn't fit below, flip above
    if (top + popH > scrollY + vh - gap) {
        const above = rect.top + scrollY - popH - gap;
        top = above;

        // If still off-screen at the top, clamp
        if (top < scrollY + gap) {
            top = Math.max(scrollY + gap, scrollY + vh - popH - gap);
        }
    }

    popover.style.left = `${left}px`;
    popover.style.top  = `${top}px`;
    // -------------------------------

    currentPopover = popover;
    
    // Close popover when clicking outside
    setTimeout(() => {
        document.addEventListener('click', closePopover);
    }, 0);
}


function closePopover() {
    if (currentPopover) {
        currentPopover.remove();
        currentPopover = null;
        document.removeEventListener('click', closePopover);
    }
}

function changeMonth(direction) {
    currentDate.setMonth(currentDate.getMonth() + direction);
    renderCalendar();
    closePopover();
}

// Admin functions
let currentAdminSection = 'pending';

function showAdminSection(section) {
    // Hide all sections
    document.querySelectorAll('.admin-section').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.admin-tab-btn').forEach(btn => btn.classList.remove('active'));
    
    // Show selected section
    document.getElementById(`admin-${section}`).classList.remove('hidden');
    
    // Find and activate the correct tab button
    const tabButtons = document.querySelectorAll('.admin-tab-btn');
    tabButtons.forEach((btn, index) => {
        if ((section === 'pending'       && index === 0) ||
            (section === 'employees'     && index === 1) ||
            (section === 'all-requests'  && index === 2) ||
            (section === 'employee-view' && index === 3) ||
            (section === 'attendance'    && index === 4) ||
            (section === 'reports'       && index === 5) ||
            (section === 'toil'          && index === 6)) {
            btn.classList.add('active');
        }
    });
    
    currentAdminSection = section;
    
    // Load data for specific sections
    if (section === 'employee-view') {
        loadEmployeeQuickView();
    } else if (section === 'reports') {
        loadReportsSection();
    } else if (section === 'attendance') {
        loadAttendanceReview();
    } else if (section === 'toil') {
        loadToilLog();
    }
}

async function loadAdminData() {
    try {
        document.getElementById('admin-loading').classList.remove('hidden');
        document.getElementById('admin-content').classList.add('hidden');
        
        await loadEmployees();
        await loadHolidayRequests();
        
        loadPendingRequests();
        loadEmployeeList();
        loadAllRequests();
        loadEmployeeQuickView();
        loadReportsSection();
        loadAttendanceReview();
        
        document.getElementById('admin-loading').classList.add('hidden');
        document.getElementById('admin-content').classList.remove('hidden');
    } catch (error) {
        document.getElementById('admin-loading').classList.add('hidden');
        document.getElementById('admin-error').textContent = 'Failed to load admin data: ' + error.message;
        document.getElementById('admin-error').classList.remove('hidden');
    }
}

function loadEmployeeQuickView() {
    const container = document.getElementById('employee-quick-view');
    
    if (employees.length === 0) {
        renderEmptyState(container, {
            icon: 'users',
            title: 'No employees yet',
            description: 'Add employees from the Employee Management section to see their summaries here.',
            action: { label: 'Add an employee', variant: 'btn-ghost', onClick: "showAdminSection('employees')" }
        });
        return;
    }
    
    container.innerHTML = employees.map(employee => {
        const employeeRequests = holidayRequests.filter(req => req.employeeId === employee.id);
        const pendingCount = employeeRequests.filter(req => req.status === 'pending').length;
        const approvedCount = employeeRequests.filter(req => req.status === 'approved').length;
        const cancelledCount = employeeRequests.filter(req => req.status === 'cancelled').length;
        
        // Count by type
        const holidayCount = employeeRequests.filter(req => (!req.requestType || req.requestType === 'holiday')).length;
        const sickCount = employeeRequests.filter(req => req.requestType === 'sick').length;
        const bereavementCount = employeeRequests.filter(req => req.requestType === 'bereavement').length;
        
        return `
            <div class="employee-summary" onclick="showEmployeeDetail(${employee.id})">
                <div class="employee-name">${employee.name}</div>
                <div class="employee-stats">
                    Allowance: ${employee.totalAllowance} | Used: ${employee.usedDays} | Remaining: ${employee.totalAllowance - employee.usedDays} |
                    Requests: ${employeeRequests.length} total (${pendingCount} pending, ${approvedCount} approved, ${cancelledCount} cancelled) |
                    Types: ${holidayCount} holidays, ${sickCount} sick, ${bereavementCount} bereavement
                </div>
            </div>
        `;
    }).join('');
}

function showEmployeeDetail(employeeId) {
    const employee = employees.find(emp => emp.id === employeeId);
    if (!employee) return;
    
    const employeeRequests = holidayRequests.filter(req => req.employeeId === employeeId);
    
    document.getElementById('employee-modal-title').textContent = `${employee.name} - Request History (${currentYear})`;
    
    let content = `
        <div class="allowance-info" style="margin-bottom: 20px;">
            <h4>Holiday Allowance Summary</h4>
            <p>Total: ${employee.totalAllowance} days | Used: ${employee.usedDays} days | Remaining: ${employee.totalAllowance - employee.usedDays} days</p>
        </div>
    `;
    
    if (employeeRequests.length === 0) {
        content += `
            <div class="empty-state">
                <div class="empty-state-icon">${EMPTY_ICONS.calendar}</div>
                <h4 class="empty-state-title">No requests yet</h4>
                <p class="empty-state-desc">${employee.name} hasn't submitted any holiday requests for ${currentYear}.</p>
            </div>
        `;
    } else {
        // Sort by submitted date (newest first)
        const sortedRequests = [...employeeRequests].sort((a, b) => 
            new Date(b.submittedDate) - new Date(a.submittedDate)
        );
        
        content += '<h4>All Requests</h4>';
        content += sortedRequests.map(request => {
            const dateRange = request.startDate === request.endDate ? 
                request.startDate : 
                `${request.startDate} to ${request.endDate}`;
            
            let dayText;
            if (request.isHalfDay) {
                dayText = `${request.days} day (${request.halfDayPeriod} half-day)`;
            } else if (request.isBlockBooking && request.selectedDates) {
                dayText = `${request.days} days (Block booking: ${request.selectedDates.length} selected dates)`;
            } else {
                dayText = `${request.days} days`;
            }
            
            const requestType = request.requestType || 'holiday';
            const typeText = requestType === 'holiday' ? 'Holiday' : 
                            requestType === 'sick' ? 'Sick Leave' : 'Bereavement Leave';
            
            // Add block booking details if applicable
            let blockBookingDetails = '';
            if (request.isBlockBooking && request.selectedDates) {
                const formattedDates = request.selectedDates.map(dateStr => {
                    const date = new Date(dateStr);
                    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                }).join(', ');
                
                blockBookingDetails = `<div><strong>Selected Dates:</strong> ${formattedDates}</div>`;
            }
            
            return `
                <div class="compact-request ${request.status}">
                    <div class="request-header">
                        <span class="request-dates">${dateRange}</span>
                        <span class="status-badge status-${request.status}">${request.status}</span>
                    </div>
                    <div><strong>Type:</strong> ${typeText}</div>
                    <div><strong>Days:</strong> ${dayText}</div>
                    ${blockBookingDetails}
                    <div><strong>Reason:</strong> ${request.reason || 'Not specified'}</div>
                    <div><strong>Submitted:</strong> ${request.submittedDate}</div>
                    ${request.deductFromHoliday && requestType !== 'holiday' ? '<div><em>Deducted from holiday allowance</em></div>' : ''}
                </div>
            `;
        }).join('');
    }
    
    document.getElementById('employee-modal-content').innerHTML = content;
    
    // Force show the modal
    const modal = document.getElementById('employee-modal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

function closeEmployeeModal() {
    const modal = document.getElementById('employee-modal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
}

function loadPendingRequests() {
    const container = document.getElementById('pending-requests');
    const pendingRequests = holidayRequests.filter(req => req.status === 'pending');
    
    if (pendingRequests.length === 0) {
        // Find last approval to give context
        const approved = holidayRequests
            .filter(r => r.status === 'approved' && r.approvedDate)
            .sort((a, b) => (b.approvedDate || '').localeCompare(a.approvedDate || ''));
        const lastApproval = approved[0];
        let context = '';
        if (lastApproval) {
            const d = new Date(lastApproval.approvedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            context = `Last approval: ${lastApproval.employeeName} · ${d}`;
        }
        renderEmptyState(container, {
            icon: 'check',
            tone: 'success',
            title: "You're all caught up",
            description: 'No pending holiday requests need your attention right now.',
            contextLine: context
        });
        return;
    }
    
    container.innerHTML = pendingRequests.map(request => {
        const dateRange = request.startDate === request.endDate ? 
            request.startDate : 
            `${request.startDate} to ${request.endDate}`;
        
        let dayText;
        if (request.isHalfDay) {
            dayText = `${request.days} day (${request.halfDayPeriod} half-day)`;
        } else if (request.isBlockBooking && request.selectedDates) {
            dayText = `${request.days} days (Block booking: ${request.selectedDates.length} selected dates)`;
        } else {
            dayText = `${request.days} days`;
        }
        
        const requestType = request.requestType || 'holiday';
        const typeText = requestType === 'holiday' ? 'Holiday' : 
                        requestType === 'sick' ? 'Sick Leave' : 'Bereavement Leave';
        
        // Add block booking details if applicable
        let blockBookingDetails = '';
        if (request.isBlockBooking && request.selectedDates) {
            const formattedDates = request.selectedDates.map(dateStr => {
                const date = new Date(dateStr);
                return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            }).join(', ');
            
            blockBookingDetails = `
                <div style="background: #e3f2fd; border: 1px solid #bbdefb; border-radius: 6px; padding: 12px; margin-top: 15px;">
                    <p style="margin: 0 0 8px 0; font-weight: 500; color: #1565c0;">
                        📅 Block Booking - Selected Dates:
                    </p>
                    <div style="font-size: 14px; color: #1976d2;">
                        ${formattedDates}
                    </div>
                </div>
            `;
        }
        
        // Find other employees who are off during the same period
        const conflictingEmployees = getConflictingEmployees(request);
        let conflictInfo = '';
        
        if (conflictingEmployees.length > 0) {
            conflictInfo = `
                <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 12px; margin-top: 15px;">
                    <p style="margin: 0 0 8px 0; font-weight: 500; color: #856404;">
                        ⚠️ Other employees also off during this period:
                    </p>
                    ${conflictingEmployees.map(emp => `
                        <div style="margin-bottom: 6px; font-size: 14px; color: #856404;">
                            <strong>${emp.name}</strong>: ${emp.dateRange} 
                            <span style="font-size: 12px; background: rgba(133, 100, 4, 0.1); padding: 2px 6px; border-radius: 3px;">
                                ${emp.type}${emp.isHalfDay ? ` (${emp.halfDayPeriod})` : ''}
                            </span>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        return `
            <div class="holiday-request pending">
                <h4>${request.employeeName}</h4>
                <p><strong>Type:</strong> ${typeText}</p>
                <p><strong>Dates:</strong> ${dateRange} (${dayText})</p>
                <p><strong>Reason:</strong> ${request.reason || 'Not specified'}</p>
                <p><strong>Submitted:</strong> ${request.submittedDate}</p>
                ${request.deductFromHoliday && requestType !== 'holiday' ? '<p><em>Will be deducted from holiday allowance</em></p>' : ''}
                ${blockBookingDetails}
                ${conflictInfo}
                <div class="action-buttons">
                    <button class="btn-approve" onclick="approveRequest(${request.id})">Approve</button>
                    <button class="btn-reject" onclick="rejectRequest(${request.id})">Reject</button>
                </div>
            </div>
        `;
    }).join('');
}

function getConflictingEmployees(pendingRequest) {
    // Get all approved requests from other employees
    const approvedRequests = holidayRequests.filter(req => 
        req.status === 'approved' && 
        req.employeeId !== pendingRequest.employeeId
    );
    
    const conflictingEmployees = [];
    
    // Handle block booking conflicts
    if (pendingRequest.isBlockBooking && pendingRequest.selectedDates) {
        const pendingDates = pendingRequest.selectedDates;
        
        approvedRequests.forEach(request => {
            let hasOverlap = false;
            let overlappingDates = [];
            
            if (request.isBlockBooking && request.selectedDates) {
                // Both are block bookings - check for any common dates
                overlappingDates = pendingDates.filter(date => request.selectedDates.includes(date));
                hasOverlap = overlappingDates.length > 0;
            } else {
                // Pending is block booking, approved is date range
                const requestStart = new Date(request.startDate);
                const requestEnd = new Date(request.endDate);
                
                overlappingDates = pendingDates.filter(dateStr => {
                    const date = new Date(dateStr);
                    return date >= requestStart && date <= requestEnd;
                });
                hasOverlap = overlappingDates.length > 0;
            }
            
            if (hasOverlap) {
                const dateRange = request.startDate === request.endDate ? 
                    request.startDate : 
                    `${request.startDate} to ${request.endDate}`;
                
                const requestType = request.requestType || 'holiday';
                const typeText = requestType === 'holiday' ? 'Holiday' : 
                               requestType === 'sick' ? 'Sick Leave' : 'Bereavement Leave';
                
                conflictingEmployees.push({
                    name: request.employeeName,
                    dateRange: dateRange,
                    type: typeText,
                    isHalfDay: request.isHalfDay,
                    halfDayPeriod: request.halfDayPeriod
                });
            }
        });
    } else {
        // Handle regular date range conflicts (existing logic)
        const pendingStart = new Date(pendingRequest.startDate);
        const pendingEnd = new Date(pendingRequest.endDate);
        
        approvedRequests.forEach(request => {
            let hasOverlap = false;
            
            if (request.isBlockBooking && request.selectedDates) {
                // Pending is date range, approved is block booking
                hasOverlap = request.selectedDates.some(dateStr => {
                    const date = new Date(dateStr);
                    return date >= pendingStart && date <= pendingEnd;
                });
            } else {
                // Both are date ranges
                const requestStart = new Date(request.startDate);
                const requestEnd = new Date(request.endDate);
                hasOverlap = requestStart <= pendingEnd && requestEnd >= pendingStart;
            }
            
            if (hasOverlap) {
                // Check if any of the overlapping days are weekdays
                let hasWeekdayOverlap = false;
                
                if (request.isBlockBooking && request.selectedDates) {
                    hasWeekdayOverlap = request.selectedDates.some(dateStr => {
                        const date = new Date(dateStr);
                        const dayOfWeek = date.getDay();
                        return date >= pendingStart && date <= pendingEnd && 
                               dayOfWeek !== 0 && dayOfWeek !== 6;
                    });
                } else {
                    const requestStart = new Date(request.startDate);
                    const requestEnd = new Date(request.endDate);
                    const checkStart = new Date(Math.max(pendingStart, requestStart));
                    const checkEnd = new Date(Math.min(pendingEnd, requestEnd));
                    
                    const current = new Date(checkStart);
                    while (current <= checkEnd) {
                        const dayOfWeek = current.getDay();
                        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                            hasWeekdayOverlap = true;
                            break;
                        }
                        current.setDate(current.getDate() + 1);
                    }
                }
                
                if (hasWeekdayOverlap) {
                    const dateRange = request.startDate === request.endDate ? 
                        request.startDate : 
                        `${request.startDate} to ${request.endDate}`;
                    
                    const requestType = request.requestType || 'holiday';
                    const typeText = requestType === 'holiday' ? 'Holiday' : 
                                   requestType === 'sick' ? 'Sick Leave' : 'Bereavement Leave';
                    
                    conflictingEmployees.push({
                        name: request.employeeName,
                        dateRange: dateRange,
                        type: typeText,
                        isHalfDay: request.isHalfDay,
                        halfDayPeriod: request.halfDayPeriod
                    });
                }
            }
        });
    }
    
    return conflictingEmployees;
}

// Email notification function
async function sendEmailNotification(employee, request, notificationType) {
    // Check if EmailJS is configured
    if (EMAIL_CONFIG.serviceId === 'YOUR_EMAILJS_SERVICE_ID') {
        console.log('Email notifications not configured. Set up EmailJS credentials in EMAIL_CONFIG.');
        showEmailToast('Email not configured', 'Set up EmailJS to enable email notifications', 'error');
        return;
    }
    
    // Show sending toast
    const toastId = showEmailToast('Sending email...', `Notifying ${notificationType === 'new_request' ? 'admins' : employee.name}`, 'sending');
    
    try {
        // Format dates
        const startDate = new Date(request.startDate).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
        const endDate = new Date(request.endDate).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
        
        let templateId;
        let emailParams;
        
        // Determine which template and parameters to use based on notification type
        if (notificationType === 'new_request') {
            // Admin notification for new request - send to group email
            templateId = EMAIL_CONFIG.templates.adminNotification;
            
            // Determine if this is a sick leave notification (informational) or a request (needs approval)
            const isSickLeave = request.requestType === 'sick';
            const notificationPurpose = isSickLeave 
                ? 'NOTIFICATION: Employee off sick (already approved)' 
                : 'NEW REQUEST: Requires approval';
            
            emailParams = {
                to_email: EMAIL_CONFIG.adminEmail,
                to_name: 'Holiday Management Team',
                email: 'noreply@kerrandsmith.co.uk',  // For reply-to field
                employee_name: employee.name,
                request_type: request.requestType.charAt(0).toUpperCase() + request.requestType.slice(1),
                start_date: startDate,
                end_date: endDate,
                days: request.days,
                reason: request.reason || 'No reason provided',
                half_day_period: request.isHalfDay ? ` (${request.halfDayPeriod.toUpperCase()})` : '',
                is_block_booking: request.isBlockBooking ? 'Yes' : 'No',
                year: currentYear,
                notification_purpose: notificationPurpose,  // New field for template
                status: isSickLeave ? 'Approved (Automatic)' : 'Pending Approval'  // New field for template
            };
            
            console.log(`Sending admin notification to: ${EMAIL_CONFIG.adminEmail}`);
            console.log(`Notification type: ${isSickLeave ? 'Sick Leave (Informational)' : 'Request (Approval Required)'}`);
            
        } else {
            // Employee notification for approve/decline/cancel
            templateId = EMAIL_CONFIG.templates.employeeNotification;
            
            // Determine status text and color
            let statusText = notificationType.toUpperCase();
            let statusColor = '#6c757d';
            if (notificationType === 'approved') {
                statusText = 'APPROVED';
                statusColor = '#28a745';
            } else if (notificationType === 'declined') {
                statusText = 'DECLINED';
                statusColor = '#dc3545';
            } else if (notificationType === 'cancelled') {
                statusText = 'CANCELLED';
                statusColor = '#ffc107';
            }
            
            emailParams = {
                to_email: employee.email || 'employee@example.com',  // You'll need to add employee emails
                to_name: employee.name,
                employee_name: employee.name,
                request_type: request.requestType.charAt(0).toUpperCase() + request.requestType.slice(1),
                start_date: startDate,
                end_date: endDate,
                days: request.days,
                status: statusText,
                half_day_period: request.isHalfDay ? ` (${request.halfDayPeriod.toUpperCase()})` : '',
                status_color: statusColor
            };
            
            console.log(`Sending employee notification to: ${employee.name}`);
        }
        
        // Send email using EmailJS
        await emailjs.send(
            EMAIL_CONFIG.serviceId,
            templateId,
            emailParams,
            EMAIL_CONFIG.publicKey
        );
        
        console.log(`✓ Email sent successfully`);
        
        // Remove sending toast and show success
        removeToast(toastId);
        const successMessage = notificationType === 'new_request' 
            ? 'Admins notified' 
            : `${employee.name} notified`;
        showEmailToast('Email sent!', successMessage, 'success', 3000);
        
    } catch (error) {
        console.error('Failed to send email notification:', error);
        console.error('Error details:', {
            message: error.message,
            text: error.text,
            status: error.status
        });
        
        // Remove sending toast and show error
        removeToast(toastId);
        
        // Show more helpful error message
        let errorMsg = 'Could not send email notification';
        if (error.text) {
            errorMsg = error.text;
        } else if (error.message) {
            errorMsg = error.message;
        }
        
        showEmailToast('Email failed', errorMsg, 'error', 5000);
        
        // Don't throw error - we don't want to break the approve/decline/submit flow if email fails
    }
}

// ====================================================================
// NOTIFICATION SYSTEM
// Provides:
//   toast({type, title, message, duration, actions}) — show a toast
//   toast.success(msg, opts), .error(), .warning(), .info()
//   toast.loading(msg) — sticky toast with spinner; returns handle with
//                        .success(msg), .error(msg, opts), .dismiss()
//   confirmDialog({title, message, confirmLabel, danger}) — async confirm
//   renderEmptyState(container, opts) — pretty empty state
// ====================================================================

const TOAST_ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
    loading: '<div class="toast-spinner"></div>'
};

let _toastSeq = 0;

function _ensureToastContainer() {
    let c = document.getElementById('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        c.className = 'toast-container';
        document.body.appendChild(c);
    }
    return c;
}

function _dismissToast(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 230);
}

function _showToast(opts = {}) {
    const {
        type = 'info',
        title = '',
        message = '',
        duration = (type === 'error' ? 6000 : type === 'loading' ? 0 : 4000),
        actions = [],
        dismissible = true
    } = opts;

    const id = `toast-${++_toastSeq}`;
    const container = _ensureToastContainer();
    const el = document.createElement('div');
    el.id = id;
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const safeTitle = title ? `<div class="toast-title">${title}</div>` : '';
    const safeMessage = message ? `<div class="toast-message">${message}</div>` : '';

    const actionsHtml = (actions && actions.length) ? `
        <div class="toast-actions">
            ${actions.map((a, i) =>
                `<button type="button" class="toast-action-btn ${a.primary ? 'primary' : ''}" data-action="${i}">${a.label}</button>`
            ).join('')}
        </div>` : '';

    const closeBtn = (dismissible && type !== 'loading') ? `
        <button type="button" class="toast-close" aria-label="Dismiss">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>` : '';

    el.innerHTML = `
        <div class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</div>
        <div class="toast-body">
            ${safeTitle}
            ${safeMessage}
            ${actionsHtml}
        </div>
        ${closeBtn}
    `;

    container.appendChild(el);

    // Wire close button
    const closeEl = el.querySelector('.toast-close');
    if (closeEl) closeEl.addEventListener('click', () => _dismissToast(id));

    // Wire action buttons
    if (actions && actions.length) {
        el.querySelectorAll('.toast-action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.action, 10);
                const action = actions[idx];
                if (action && typeof action.onClick === 'function') action.onClick();
                if (!action || action.dismissOnClick !== false) _dismissToast(id);
            });
        });
    }

    if (duration > 0) {
        setTimeout(() => _dismissToast(id), duration);
    }

    return {
        id,
        dismiss: () => _dismissToast(id),
        update: (newOpts) => {
            _dismissToast(id);
            return _showToast(newOpts);
        }
    };
}

// Public API
const toast = (opts) => _showToast(opts);
toast.success  = (msg, opts = {}) => _showToast({ ...opts, type: 'success', message: msg });
toast.error    = (msg, opts = {}) => _showToast({ ...opts, type: 'error',   message: msg });
toast.warning  = (msg, opts = {}) => _showToast({ ...opts, type: 'warning', message: msg });
toast.info     = (msg, opts = {}) => _showToast({ ...opts, type: 'info',    message: msg });

// Loading toast — returns handle with .success/.error/.dismiss
toast.loading = (msg, title = '') => {
    const handle = _showToast({ type: 'loading', title, message: msg, duration: 0, dismissible: false });
    return {
        ...handle,
        success: (newMsg, newTitle) => handle.update({ type: 'success', title: newTitle || '', message: newMsg }),
        error:   (newMsg, opts = {}) => handle.update({ type: 'error', title: opts.title || '', message: newMsg, actions: opts.actions, duration: opts.duration }),
        info:    (newMsg, newTitle) => handle.update({ type: 'info', title: newTitle || '', message: newMsg })
    };
};

// Backward compat — old code still calls showEmailToast()
function showEmailToast(title, message, type = 'success', duration = 4000) {
    const mapped = type === 'sending' ? 'loading' : type;
    return _showToast({ type: mapped, title, message, duration: type === 'sending' ? 0 : duration });
}
function removeToast(/* legacy - now a no-op since toasts auto-dismiss */) {}

// ============ CONFIRM DIALOG ============
function confirmDialog({
    title = 'Are you sure?',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false
} = {}) {
    return new Promise((resolve) => {
        const modal     = document.getElementById('confirm-modal');
        const titleEl   = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const okBtn     = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');
        const iconEl    = document.getElementById('confirm-icon');

        if (!modal || !okBtn || !cancelBtn) {
            // Fall back if HTML isn't there
            resolve(window.confirm(message || title));
            return;
        }

        titleEl.textContent = title;
        messageEl.textContent = message;
        okBtn.textContent = confirmLabel;
        cancelBtn.textContent = cancelLabel;
        modal.classList.toggle('is-danger', !!danger);

        // Icon
        iconEl.innerHTML = danger
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

        modal.classList.remove('hidden');

        const cleanup = (result) => {
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            resolve(result);
        };
        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        const onBackdrop = (e) => { if (e.target === modal) cleanup(false); };
        const onKey = (e) => {
            if (e.key === 'Escape') cleanup(false);
            if (e.key === 'Enter')  cleanup(true);
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
        setTimeout(() => okBtn.focus(), 50);
    });
}

// ============ EMPTY STATES ============
const EMPTY_ICONS = {
    inbox:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>',
    check:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
    users:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>',
    file:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
    search:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'
};

function renderEmptyState(container, opts = {}) {
    if (!container) return;
    const {
        icon = 'inbox',
        title = 'Nothing here yet',
        description = '',
        contextLine = '',
        tone = 'default',          // 'success' | 'info' | 'default'
        action = null              // {label, onClick (string of JS), variant}
    } = opts;
    const iconHtml = EMPTY_ICONS[icon] || icon; // accept raw SVG too
    container.innerHTML = `
        <div class="empty-state ${tone !== 'default' ? 'tone-' + tone : ''}">
            <div class="empty-state-icon">${iconHtml}</div>
            <h4 class="empty-state-title">${title}</h4>
            ${description ? `<p class="empty-state-desc">${description}</p>` : ''}
            ${contextLine ? `<div class="empty-state-context">${contextLine}</div>` : ''}
            ${action ? `<div class="empty-state-action"><button class="${action.variant || 'btn-ghost'}" onclick="${action.onClick}">${action.label}</button></div>` : ''}
        </div>
    `;
}

// Re-render admin sub-views without re-fetching from GitHub.
// Used after optimistic updates so the UI reflects local state.
function refreshAdminViews() {
    if (typeof loadPendingRequests === 'function')     loadPendingRequests();
    if (typeof loadEmployeeList === 'function')        loadEmployeeList();
    if (typeof loadAllRequests === 'function')         loadAllRequests();
    if (typeof loadEmployeeQuickView === 'function')   loadEmployeeQuickView();
    if (typeof loadReportsSection === 'function')      loadReportsSection();
    if (typeof loadAttendanceReview === 'function')    loadAttendanceReview();
    if (typeof loadToilLog === 'function')             loadToilLog();
}

async function approveRequest(requestId) {
    const request = holidayRequests.find(req => req.id === requestId);
    if (!request) return;

    const authoriser = promptAuthoriser(`approve ${request.employeeName}'s ${request.requestType || 'holiday'} request`);
    if (!authoriser) return;

    // ----- Snapshot for rollback -----
    const employee = employees.find(emp => emp.id === request.employeeId);
    const willDeductDays = !!(employee && (request.requestType === 'holiday' || request.deductFromHoliday));
    const snapshot = {
        request: { ...request },
        employee: willDeductDays ? { ...employee } : null
    };

    // ----- Apply optimistically -----
    request.status = 'approved';
    request.approvedDate = new Date().toISOString().split('T')[0];
    request.approvedBy = authoriser;
    if (willDeductDays) employee.usedDays += request.days;

    // Re-render UI immediately (no GitHub round-trip wait)
    refreshAdminViews();
    renderCalendar();
    updatePendingBadge();

    const loading = toast.loading(`Approving ${request.employeeName}'s request…`);

    try {
        if (willDeductDays) await saveEmployees();
        await saveHolidayRequests();
        if (employee) await sendEmailNotification(employee, request, 'approved');
        loading.success(`Approved · ${request.employeeName}`);
    } catch (err) {
        // ----- Rollback -----
        Object.assign(request, snapshot.request);
        if (snapshot.employee && employee) Object.assign(employee, snapshot.employee);
        refreshAdminViews();
        renderCalendar();
        updatePendingBadge();
        loading.error(`Couldn't approve — ${err.message || 'save failed'}`, {
            actions: [{ label: 'Retry', primary: true, onClick: () => approveRequest(requestId) }]
        });
    }
}

async function rejectRequest(requestId) {
    const request = holidayRequests.find(req => req.id === requestId);
    if (!request) return;

    const authoriser = promptAuthoriser(`reject ${request.employeeName}'s ${request.requestType || 'holiday'} request`);
    if (!authoriser) return;

    const employee = employees.find(emp => emp.id === request.employeeId);

    // If a previously-approved request is being rejected, restore the days
    const wasApprovedAndDeducted = request.status === 'approved' &&
        (request.requestType === 'holiday' || request.deductFromHoliday) && employee;

    const snapshot = {
        request: { ...request },
        employee: wasApprovedAndDeducted ? { ...employee } : null
    };

    if (wasApprovedAndDeducted) employee.usedDays -= request.days;
    request.status = 'rejected';
    request.rejectedDate = new Date().toISOString().split('T')[0];
    request.rejectedBy = authoriser;

    refreshAdminViews();
    renderCalendar();
    updatePendingBadge();

    const loading = toast.loading(`Rejecting ${request.employeeName}'s request…`);

    try {
        if (wasApprovedAndDeducted) await saveEmployees();
        await saveHolidayRequests();
        if (employee) await sendEmailNotification(employee, request, 'declined');
        loading.success(`Rejected · ${request.employeeName}`);
    } catch (err) {
        Object.assign(request, snapshot.request);
        if (snapshot.employee && employee) Object.assign(employee, snapshot.employee);
        refreshAdminViews();
        renderCalendar();
        updatePendingBadge();
        loading.error(`Couldn't reject — ${err.message || 'save failed'}`, {
            actions: [{ label: 'Retry', primary: true, onClick: () => rejectRequest(requestId) }]
        });
    }
}

async function addEmployee(event) {
    event.preventDefault();
    
    const name = document.getElementById('new-employee-name').value;
    const allowance = parseFloat(document.getElementById('employee-allowance').value);
    const includeSaturdayDeduction = document.getElementById('include-saturday-deduction').checked;
    
    if (!name || name.trim() === '') {
        toast.warning('Please enter an employee name.');
        return;
    }
    
    const newEmployee = {
        id: nextEmployeeId++,
        name: name.trim(),
        totalAllowance: allowance,
        usedDays: 0,
        includeSaturdayDeduction: includeSaturdayDeduction
    };
    
    employees.push(newEmployee);
    await saveEmployees();
    
    // Refresh displays
    populateEmployeeCards();
    loadEmployeeList();
    
    // Reset form
    document.getElementById('add-employee-form').reset();
}

async function removeEmployee(employeeId) {
    const emp = employees.find(e => e.id === employeeId);
    const name = emp ? emp.name : 'this employee';
    const requestCount = holidayRequests.filter(r => r.employeeId === employeeId).length;

    const ok = await confirmDialog({
        title: `Remove ${name}?`,
        message: requestCount > 0
            ? `This will permanently delete ${name}'s record and all ${requestCount} associated request${requestCount === 1 ? '' : 's'}. This cannot be undone.`
            : `This will permanently delete ${name}'s record. This cannot be undone.`,
        confirmLabel: 'Remove employee',
        cancelLabel: 'Keep',
        danger: true
    });
    if (!ok) return;

    employees = employees.filter(emp => emp.id !== employeeId);
    holidayRequests = holidayRequests.filter(req => req.employeeId !== employeeId);

    populateEmployeeCards();
    refreshAdminViews();
    renderCalendar();

    // Clear employee info if removed employee was selected
    if (currentEmployee && currentEmployee.id === employeeId) {
        currentEmployee = null;
        document.getElementById('employee-info').classList.add('hidden');
        document.querySelectorAll('.employee-card-selector').forEach(card => {
            card.classList.remove('selected');
        });
    }

    const loading = toast.loading(`Removing ${name}…`);
    try {
        await saveEmployees();
        await saveHolidayRequests();
        loading.success(`${name} removed`);
    } catch (err) {
        loading.error(`Couldn't save changes — ${err.message || 'please try again'}`);
    }
}

function loadEmployeeList() {
    const container = document.getElementById('employee-list');
    
    if (employees.length === 0) {
        renderEmptyState(container, {
            icon: 'users',
            tone: 'info',
            title: 'No employees yet',
            description: 'Use the form on the left to add your first employee. They\'ll appear here once added.'
        });
        return;
    }
    
    container.innerHTML = employees.map(employee => `
        <div class="employee-card">
            <div>
                <h5>${employee.name}</h5>
                <p style="font-size: 13px;">Total: ${employee.totalAllowance} | Used: ${employee.usedDays} | Remaining: ${employee.totalAllowance - employee.usedDays}</p>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="btn-edit btn-small" onclick="openEditEmployeeModal(${employee.id})">Edit</button>
                <button class="btn-danger btn-small" onclick="removeEmployee(${employee.id})">Remove</button>
            </div>
        </div>
    `).join('');
}

// Edit Employee Modal Functions
function openEditEmployeeModal(employeeId) {
    const employee = employees.find(emp => emp.id === employeeId);
    if (!employee) return;
    
    document.getElementById('edit-employee-id').value = employee.id;
    document.getElementById('edit-employee-name-display').textContent = employee.name;
    document.getElementById('edit-employee-current-allowance').textContent = employee.totalAllowance;
    document.getElementById('edit-employee-used-days').textContent = employee.usedDays;
    document.getElementById('edit-employee-remaining').textContent = employee.totalAllowance - employee.usedDays;
    document.getElementById('edit-allowance-adjustment').value = '';
    document.getElementById('edit-adjustment-reason').value = '';
    document.getElementById('edit-saturday-deduction').checked = employee.includeSaturdayDeduction || false;

    // Inject (or refresh) TOIL summary card if employee has any TOIL
    const modalBody = document.querySelector('#edit-employee-modal .modal-body');
    let toilCard = document.getElementById('edit-employee-toil-card');
    if (toilCard) toilCard.remove();
    const toilEarned = employee.toilEarned || 0;
    if (toilEarned > 0) {
        toilCard = document.createElement('div');
        toilCard.id = 'edit-employee-toil-card';
        toilCard.className = 'toil-summary-card';
        const lastEntry = (employee.toilHistory || []).slice(-1)[0];
        const lastText = lastEntry
            ? `Last grant: ${lastEntry.days} day${lastEntry.days === 1 ? '' : 's'} on ${new Date(lastEntry.dateWorked).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${lastEntry.reason ? ' · ' + lastEntry.reason : ''}`
            : '';
        toilCard.innerHTML = `
            <div>
                <div class="toil-label">TOIL earned this year</div>
                ${lastText ? `<div style="font-size: 11px; color: var(--neutral-500); margin-top: 2px;">${lastText}</div>` : ''}
            </div>
            <div class="toil-value">+${toilEarned}</div>
        `;
        // Place it right after the existing stats card (the first child div with grey background)
        const firstStatCard = modalBody.querySelector('div[style*="background: #f8f9fa"], div[style*="background:#f8f9fa"]');
        if (firstStatCard && firstStatCard.nextSibling) {
            modalBody.insertBefore(toilCard, firstStatCard.nextSibling);
        } else {
            modalBody.insertBefore(toilCard, modalBody.firstChild);
        }
    }

    const modal = document.getElementById('edit-employee-modal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

function closeEditEmployeeModal() {
    const modal = document.getElementById('edit-employee-modal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
}

async function saveEmployeeEdit(event) {
    event.preventDefault();
    
    const employeeId = parseInt(document.getElementById('edit-employee-id').value);
    const adjustment = parseFloat(document.getElementById('edit-allowance-adjustment').value) || 0;
    const includeSaturdayDeduction = document.getElementById('edit-saturday-deduction').checked;
    
    const employee = employees.find(emp => emp.id === employeeId);
    if (!employee) return;
    
    // Apply adjustment to total allowance
    if (adjustment !== 0) {
        employee.totalAllowance = Math.max(0, employee.totalAllowance + adjustment);
    }
    
    // Update Saturday deduction setting
    employee.includeSaturdayDeduction = includeSaturdayDeduction;
    
    await saveEmployees();
    
    // Refresh displays
    populateEmployeeCards();
    loadEmployeeList();
    
    // Update employee info if this employee is currently selected
    if (currentEmployee && currentEmployee.id === employeeId) {
        selectEmployee(employeeId);
    }
    
    closeEditEmployeeModal();
    
    const actionText = adjustment > 0 ? `Added ${adjustment} days` : adjustment < 0 ? `Deducted ${Math.abs(adjustment)} days` : 'Updated settings';
    toast.success(`${actionText} · new allowance ${employee.totalAllowance} days`, { title: employee.name });
}

function loadAllRequests() {
    const container = document.getElementById('all-requests');
    
    if (holidayRequests.length === 0) {
        renderEmptyState(container, {
            icon: 'inbox',
            title: 'No requests yet',
            description: 'Holiday requests will appear here as employees submit them. The newest will be at the top.'
        });
        return;
    }
    
    // Sort requests by submitted date (newest first)
    const sortedRequests = [...holidayRequests].sort((a, b) => 
        new Date(b.submittedDate) - new Date(a.submittedDate)
    );
    
    container.innerHTML = sortedRequests.map(request => {
        const dateRange = request.startDate === request.endDate ? 
            request.startDate : 
            `${request.startDate} to ${request.endDate}`;
        
        let dayText;
        if (request.isHalfDay) {
            dayText = `${request.days} day (${request.halfDayPeriod} half-day)`;
        } else if (request.isBlockBooking && request.selectedDates) {
            dayText = `${request.days} days (Block booking: ${request.selectedDates.length} selected dates)`;
        } else {
            dayText = `${request.days} days`;
        }
        
        const requestType = request.requestType || 'holiday';
        const typeText = requestType === 'holiday' ? 'Holiday' : 
                        requestType === 'sick' ? 'Sick Leave' : 'Bereavement Leave';
        
        // Add block booking details if applicable
        let blockBookingDetails = '';
        if (request.isBlockBooking && request.selectedDates) {
            const formattedDates = request.selectedDates.map(dateStr => {
                const date = new Date(dateStr);
                return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            }).join(', ');
            
            blockBookingDetails = `
                <p><strong>Selected Dates:</strong> <span style="background: #e3f2fd; padding: 2px 6px; border-radius: 4px; font-size: 14px; color: #1976d2;">${formattedDates}</span></p>
            `;
        }
        
        return `
            <div class="holiday-request ${request.status}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div style="flex: 1;">
                        <h4>${request.employeeName}</h4>
                        <p><strong>Type:</strong> ${typeText}</p>
                        <p><strong>Dates:</strong> ${dateRange} (${dayText})</p>
                        ${blockBookingDetails}
                        <p><strong>Reason:</strong> ${request.reason || 'Not specified'}</p>
                        <p><strong>Submitted:</strong> ${request.submittedDate}</p>
                        ${request.deductFromHoliday && requestType !== 'holiday' ? '<p><em>Deducted from holiday allowance</em></p>' : ''}
                        ${buildAuditStamp(request)}
                    </div>
                    <div style="margin-left: 15px;">
                        <span class="status-badge status-${request.status}">${request.status}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Build an audit stamp HTML block for a request (used in admin All Requests & employee history)
function buildAuditStamp(request) {
    if (request.status === 'approved' && request.approvedBy) {
        return `<p style="margin-top: 8px; padding: 6px 10px; background: #d4edda; border-left: 3px solid #28a745; color: #155724; font-size: 13px;">✅ <strong>Authorised by ${request.approvedBy}</strong>${request.approvedDate ? ` on ${request.approvedDate}` : ''}</p>`;
    }
    if (request.status === 'rejected' && request.rejectedBy) {
        return `<p style="margin-top: 8px; padding: 6px 10px; background: #f8d7da; border-left: 3px solid #dc3545; color: #721c24; font-size: 13px;">❌ <strong>Rejected by ${request.rejectedBy}</strong>${request.rejectedDate ? ` on ${request.rejectedDate}` : ''}</p>`;
    }
    if (request.status === 'cancelled' && request.cancelledBy) {
        return `<p style="margin-top: 8px; padding: 6px 10px; background: #e2e3e5; border-left: 3px solid #6c757d; color: #383d41; font-size: 13px;">🚫 <strong>Cancelled by ${request.cancelledBy}</strong>${request.cancelledDate ? ` on ${request.cancelledDate}` : ''}</p>`;
    }
    return '';
}

// ==================== BULK HOLIDAYS FUNCTIONS ====================

let bulkSelectedDates = [];
let bulkCalendarDate = new Date();

function openBulkHolidayModal() {
    bulkSelectedDates = [];
    bulkCalendarDate = new Date();
    renderBulkCalendar();
    updateBulkSelectedDatesList();
    
    const modal = document.getElementById('bulk-holiday-modal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

function closeBulkHolidayModal() {
    const modal = document.getElementById('bulk-holiday-modal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
    bulkSelectedDates = [];
}

function renderBulkCalendar() {
    const grid = document.getElementById('bulk-calendar-grid');
    const title = document.getElementById('bulk-calendar-title');
    
    const year = bulkCalendarDate.getFullYear();
    const month = bulkCalendarDate.getMonth();
    
    title.textContent = bulkCalendarDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startingDay = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => 
        `<div class="block-calendar-day-header">${day}</div>`
    ).join('');
    
    // Empty cells before first day
    for (let i = 0; i < startingDay; i++) {
        html += `<div class="block-calendar-day other-month"></div>`;
    }
    
    // Days of month
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateStr = date.toISOString().split('T')[0];
        const isToday = date.toDateString() === today.toDateString();
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isSelected = bulkSelectedDates.includes(dateStr);
        
        let classes = ['block-calendar-day'];
        if (isToday) classes.push('today');
        if (isWeekend) classes.push('weekend');
        if (isSelected) classes.push('selected');
        
        html += `
            <div class="${classes.join(' ')}" onclick="toggleBulkDate('${dateStr}')">
                ${day}
            </div>
        `;
    }
    
    grid.innerHTML = html;
}

function changeBulkMonth(delta) {
    bulkCalendarDate.setMonth(bulkCalendarDate.getMonth() + delta);
    renderBulkCalendar();
}

function toggleBulkDate(dateStr) {
    const index = bulkSelectedDates.indexOf(dateStr);
    if (index > -1) {
        bulkSelectedDates.splice(index, 1);
    } else {
        bulkSelectedDates.push(dateStr);
    }
    bulkSelectedDates.sort();
    renderBulkCalendar();
    updateBulkSelectedDatesList();
}

function updateBulkSelectedDatesList() {
    const container = document.getElementById('bulk-selected-dates-list');
    const countEl = document.getElementById('bulk-dates-count');
    const previewEl = document.getElementById('bulk-preview');
    
    countEl.textContent = bulkSelectedDates.length;
    
    if (bulkSelectedDates.length === 0) {
        container.innerHTML = '<p style="color: #666; font-style: italic;">No dates selected</p>';
        previewEl.innerHTML = '';
        return;
    }
    
    container.innerHTML = bulkSelectedDates.map(dateStr => {
        const date = new Date(dateStr);
        const formatted = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        return `<span class="selected-date-tag">${formatted} <span onclick="removeBulkDate('${dateStr}')" style="cursor: pointer; margin-left: 5px;">×</span></span>`;
    }).join('');
    
    // Calculate working days
    let workingDays = 0;
    bulkSelectedDates.forEach(dateStr => {
        const date = new Date(dateStr);
        if (date.getDay() !== 0 && date.getDay() !== 6) {
            workingDays++;
        }
    });
    
    previewEl.innerHTML = `
        <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin-top: 15px;">
            <p style="margin: 0; color: #1976d2;"><strong>Preview:</strong> ${bulkSelectedDates.length} date(s) selected (${workingDays} working days)</p>
            <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">This will create ${employees.length} holiday requests (one per employee)</p>
        </div>
    `;
}

function removeBulkDate(dateStr) {
    const index = bulkSelectedDates.indexOf(dateStr);
    if (index > -1) {
        bulkSelectedDates.splice(index, 1);
    }
    renderBulkCalendar();
    updateBulkSelectedDatesList();
}

async function submitBulkHolidays() {
    if (bulkSelectedDates.length === 0) {
        toast.warning('Please select at least one date.');
        return;
    }
    
    const reason = document.getElementById('bulk-holiday-reason').value || 'Company Holiday';
    const deductFromAllowance = document.getElementById('bulk-deduct-allowance').checked;
    
    const dateList = bulkSelectedDates.map(d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })).join(', ');
    const ok = await confirmDialog({
        title: 'Add holidays for everyone?',
        message: `${bulkSelectedDates.length} date${bulkSelectedDates.length === 1 ? '' : 's'} will be added for all ${employees.length} employees.\n\nDates: ${dateList}\n\n${deductFromAllowance ? 'Days WILL be deducted from each employee\'s allowance.' : 'Days will NOT be deducted from allowances.'}`,
        confirmLabel: 'Add holidays',
        cancelLabel: 'Cancel'
    });
    if (!ok) return;

    // Require authoriser name for audit trail
    const bulkAuthoriser = promptAuthoriser('authorise this bulk holiday for all employees');
    if (!bulkAuthoriser) return;
    
    // Calculate working days for each date
    let totalWorkingDays = 0;
    bulkSelectedDates.forEach(dateStr => {
        const date = new Date(dateStr);
        if (date.getDay() !== 0 && date.getDay() !== 6) {
            totalWorkingDays++;
        }
    });
    
    // Sort dates to get start and end
    const sortedDates = [...bulkSelectedDates].sort();
    const startDate = sortedDates[0];
    const endDate = sortedDates[sortedDates.length - 1];
    
    // Create request for each employee (skip those with existing bookings on those dates)
    const skippedEmployees = [];
    for (const employee of employees) {
        // Check for existing bookings on the selected dates
        const overlapping = getEmployeeOverlappingDates(employee.id, bulkSelectedDates);
        if (overlapping.length > 0) {
            skippedEmployees.push(employee.name);
            continue;
        }

        // Calculate days based on employee's Saturday setting
        let days = 0;
        bulkSelectedDates.forEach(dateStr => {
            const date = new Date(dateStr);
            const dayOfWeek = date.getDay();
            
            // Skip Sundays
            if (dayOfWeek === 0) return;
            
            // Handle Saturdays based on employee setting
            if (dayOfWeek === 6) {
                if (employee.includeSaturdayDeduction) {
                    days += 1;
                }
                return;
            }
            
            // Weekdays always count
            days += 1;
        });
        
        const newRequest = {
            id: nextRequestId++,
            employeeId: employee.id,
            employeeName: employee.name,
            requestType: 'holiday',
            startDate: startDate,
            endDate: endDate,
            days: days,
            reason: reason,
            status: 'approved', // Auto-approve bulk holidays
            submittedDate: new Date().toISOString().split('T')[0],
            approvedDate: new Date().toISOString().split('T')[0],
            approvedBy: bulkAuthoriser,
            isBlockBooking: bulkSelectedDates.length > 1,
            selectedDates: bulkSelectedDates.length > 1 ? [...bulkSelectedDates] : null,
            isBulkHoliday: true,
            deductFromHoliday: deductFromAllowance
        };
        
        holidayRequests.push(newRequest);
        
        // Update employee's used days if deducting from allowance
        if (deductFromAllowance && days > 0) {
            employee.usedDays += days;
        }
    }
    
    // Save everything
    await saveHolidayRequests();
    if (deductFromAllowance) {
        await saveEmployees();
    }
    
    // Refresh displays
    populateEmployeeCards();
    loadAdminData();
    renderCalendar();
    
    closeBulkHolidayModal();
    
    const addedCount = employees.length - skippedEmployees.length;
    if (skippedEmployees.length > 0) {
        toast.success(`Added for ${addedCount} employee${addedCount === 1 ? '' : 's'} · ${skippedEmployees.length} skipped (already had bookings: ${skippedEmployees.join(', ')})`, { title: 'Bulk holidays added', duration: 8000 });
    } else {
        toast.success(`Added for ${addedCount} employee${addedCount === 1 ? '' : 's'}`, { title: 'Bulk holidays added' });
    }
}

// ==================== END BULK HOLIDAYS FUNCTIONS ====================

// ==================== TOIL (TIME OFF IN LIEU) ====================
// Lets admins grant extra holiday days to employees who worked outside
// their normal hours (covering events, weekends etc.).
//
// Implementation:
//   - Increases employee.totalAllowance by N days
//   - Tracks running total per employee in employee.toilEarned (display only)
//   - Stores audit-trail entries in employee.toilHistory (date worked, days,
//     reason, granted by, granted on)
// Saves via existing saveEmployees() — no new GitHub file needed.

let toilSelectedEmployeeIds = new Set();

function openToilGrantModal() {
    const modal = document.getElementById('toil-grant-modal');
    if (!modal) return;

    // Reset state
    toilSelectedEmployeeIds = new Set();
    document.getElementById('toil-days').value = '1';
    document.getElementById('toil-reason').value = '';
    document.getElementById('toil-emp-search').value = '';

    // Default the date to last Saturday (most common TOIL scenario)
    const today = new Date();
    const lastSat = new Date(today);
    const daysToSat = (today.getDay() + 1) % 7 || 7;  // last Saturday
    lastSat.setDate(today.getDate() - daysToSat);
    document.getElementById('toil-date-worked').value = lastSat.toISOString().split('T')[0];

    renderToilEmployeeGrid();
    updateToilPreview();

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

function closeToilGrantModal() {
    const modal = document.getElementById('toil-grant-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
    toilSelectedEmployeeIds = new Set();
}

function renderToilEmployeeGrid() {
    const container = document.getElementById('toil-employee-grid');
    if (!container) return;

    const search = (document.getElementById('toil-emp-search')?.value || '').toLowerCase();
    const filtered = employees
        .filter(e => e.name.toLowerCase().includes(search))
        .sort((a, b) => a.name.localeCompare(b.name));

    if (filtered.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 24px; color: var(--neutral-500); font-size: 13px;">${search ? 'No employees match your search.' : 'No employees yet.'}</div>`;
        return;
    }

    container.innerHTML = filtered.map(emp => {
        const checked = toilSelectedEmployeeIds.has(emp.id);
        const toilSoFar = emp.toilEarned || 0;
        return `
            <label class="toil-emp-row ${checked ? 'is-checked' : ''}" data-employee-id="${emp.id}">
                <input type="checkbox" ${checked ? 'checked' : ''} data-employee-id="${emp.id}">
                <span>${emp.name}</span>
                ${toilSoFar > 0 ? `<span class="emp-meta">+${toilSoFar} TOIL</span>` : ''}
            </label>
        `;
    }).join('');

    // Wire checkbox change handlers
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const id = parseInt(cb.dataset.employeeId);
            if (cb.checked) toilSelectedEmployeeIds.add(id);
            else            toilSelectedEmployeeIds.delete(id);
            // Toggle visual state on the row
            const row = cb.closest('.toil-emp-row');
            if (row) row.classList.toggle('is-checked', cb.checked);
            updateToilPreview();
        });
    });
}

function toilSelectAll(check) {
    document.querySelectorAll('#toil-employee-grid .toil-emp-row').forEach(row => {
        const cb = row.querySelector('input[type="checkbox"]');
        if (!cb) return;
        const id = parseInt(cb.dataset.employeeId);
        cb.checked = check;
        if (check) toilSelectedEmployeeIds.add(id);
        else       toilSelectedEmployeeIds.delete(id);
        row.classList.toggle('is-checked', check);
    });
    updateToilPreview();
}

function updateToilPreview() {
    const days = parseFloat(document.getElementById('toil-days')?.value || 0) || 0;
    const count = toilSelectedEmployeeIds.size;
    const previewCount = document.getElementById('toil-preview-count');
    const previewTotal = document.getElementById('toil-preview-total');
    if (previewCount) previewCount.textContent = count;
    if (previewTotal) previewTotal.textContent = (count * days).toFixed(days % 1 === 0 ? 0 : 1);
}

async function submitToilGrant() {
    const dateWorked = document.getElementById('toil-date-worked').value;
    const days = parseFloat(document.getElementById('toil-days').value);
    const reason = document.getElementById('toil-reason').value.trim();
    const ids = [...toilSelectedEmployeeIds];

    // Validation
    if (!dateWorked) {
        toast.warning('Please pick the date worked.');
        return;
    }
    if (!days || days <= 0) {
        toast.warning('Days to grant must be greater than zero.');
        return;
    }
    if (ids.length === 0) {
        toast.warning('Pick at least one employee.');
        return;
    }

    // Confirm with name list
    const namesPreview = ids.slice(0, 4).map(id => employees.find(e => e.id === id)?.name).filter(Boolean);
    const namesText = namesPreview.join(', ') + (ids.length > 4 ? ` and ${ids.length - 4} other${ids.length - 4 === 1 ? '' : 's'}` : '');
    const ok = await confirmDialog({
        title: `Grant ${days} day${days === 1 ? '' : 's'} TOIL to ${ids.length} employee${ids.length === 1 ? '' : 's'}?`,
        message: `${namesText} will each have their allowance increased by ${days} day${days === 1 ? '' : 's'} for working on ${new Date(dateWorked).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`,
        confirmLabel: 'Grant TOIL',
        cancelLabel: 'Cancel'
    });
    if (!ok) return;

    // Authoriser for audit trail (uses the same prompt as approve/reject)
    const grantedBy = promptAuthoriser(`grant TOIL to ${ids.length} employee${ids.length === 1 ? '' : 's'}`);
    if (!grantedBy) return;

    // Snapshot for rollback
    const snapshot = ids.map(id => {
        const emp = employees.find(e => e.id === id);
        return emp ? { id, totalAllowance: emp.totalAllowance, toilEarned: emp.toilEarned || 0, toilHistory: emp.toilHistory ? [...emp.toilHistory] : [] } : null;
    }).filter(Boolean);

    const grantedDate = new Date().toISOString().split('T')[0];

    // Apply optimistically
    const grantedNames = [];
    ids.forEach(id => {
        const emp = employees.find(e => e.id === id);
        if (!emp) return;
        emp.totalAllowance = (emp.totalAllowance || 0) + days;
        emp.toilEarned     = (emp.toilEarned     || 0) + days;
        emp.toilHistory    = emp.toilHistory || [];
        emp.toilHistory.push({
            id: `toil-${Date.now()}-${id}`,
            dateWorked,
            days,
            reason: reason || null,
            grantedBy,
            grantedDate
        });
        grantedNames.push(emp.name);
    });

    // Re-render UI immediately
    closeToilGrantModal();
    populateEmployeeCards();
    refreshAdminViews();

    const loading = toast.loading(`Granting TOIL to ${ids.length} employee${ids.length === 1 ? '' : 's'}…`);

    try {
        await saveEmployees();
        const totalDays = (ids.length * days).toFixed(days % 1 === 0 ? 0 : 1);
        loading.success(`Granted ${days} day${days === 1 ? '' : 's'} to ${ids.length} employee${ids.length === 1 ? '' : 's'} · ${totalDays} TOIL days total`, 'TOIL granted');
    } catch (err) {
        // Rollback
        snapshot.forEach(snap => {
            const emp = employees.find(e => e.id === snap.id);
            if (emp) {
                emp.totalAllowance = snap.totalAllowance;
                emp.toilEarned     = snap.toilEarned;
                emp.toilHistory    = snap.toilHistory;
            }
        });
        populateEmployeeCards();
        refreshAdminViews();
        loading.error(`Couldn't save — ${err.message || 'GitHub save failed'}`, {
            actions: [{ label: 'Retry', primary: true, onClick: () => {
                // Re-open modal with same selection
                ids.forEach(id => toilSelectedEmployeeIds.add(id));
                openToilGrantModal();
                document.getElementById('toil-date-worked').value = dateWorked;
                document.getElementById('toil-days').value = days;
                document.getElementById('toil-reason').value = reason;
                renderToilEmployeeGrid();
                updateToilPreview();
            } }]
        });
    }
}
// ----- TOIL Log view -----
function loadToilLog() {
    const statsEl   = document.getElementById('toil-summary-stats');
    const contentEl = document.getElementById('toil-log-content');
    if (!statsEl || !contentEl) return;

    // Build a flat list of every entry, with employee name attached
    const allEntries = [];
    employees.forEach(emp => {
        (emp.toilHistory || []).forEach(entry => {
            allEntries.push({ ...entry, employeeId: emp.id, employeeName: emp.name });
        });
    });

    // Stats
    const totalEntries  = allEntries.length;
    const totalDays     = allEntries.reduce((s, e) => s + (e.days || 0), 0);
    const peopleAwarded = new Set(allEntries.map(e => e.employeeId)).size;
    const last30Days    = allEntries.filter(e => {
        const d = new Date(e.grantedDate);
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
        return d >= cutoff;
    });
    const last30Total = last30Days.reduce((s, e) => s + (e.days || 0), 0);

    statsEl.innerHTML = `
        <div class="toil-stat">
            <div class="toil-stat-label">Days granted ${currentYear}</div>
            <div class="toil-stat-value">${totalDays % 1 === 0 ? totalDays : totalDays.toFixed(1)}</div>
            <div class="toil-stat-sub">${totalEntries} grant${totalEntries === 1 ? '' : 's'} on record</div>
        </div>
        <div class="toil-stat">
            <div class="toil-stat-label">Employees awarded</div>
            <div class="toil-stat-value">${peopleAwarded}</div>
            <div class="toil-stat-sub">of ${employees.length} total</div>
        </div>
        <div class="toil-stat">
            <div class="toil-stat-label">Last 30 days</div>
            <div class="toil-stat-value">${last30Total % 1 === 0 ? last30Total : last30Total.toFixed(1)}</div>
            <div class="toil-stat-sub">${last30Days.length} grant${last30Days.length === 1 ? '' : 's'}</div>
        </div>
    `;

    // If no entries at all → empty state and stop
    if (totalEntries === 0) {
        contentEl.innerHTML = '';
        renderEmptyState(contentEl, {
            icon: 'inbox',
            tone: 'info',
            title: 'No TOIL granted yet',
            description: 'Click "Grant TOIL" above to award extra holiday days to employees who worked outside their normal hours.'
        });
        return;
    }

    // Group by employee, then sort entries within each by date worked (newest first)
    const byEmployee = {};
    allEntries.forEach(e => {
        if (!byEmployee[e.employeeId]) {
            byEmployee[e.employeeId] = { name: e.employeeName, employeeId: e.employeeId, entries: [], total: 0 };
        }
        byEmployee[e.employeeId].entries.push(e);
        byEmployee[e.employeeId].total += (e.days || 0);
    });

    // Sort employees by total TOIL desc (most TOIL first), then alphabetically
    const sortedGroups = Object.values(byEmployee).sort((a, b) =>
        b.total - a.total || a.name.localeCompare(b.name)
    );

    // Sort each employee's entries by dateWorked desc (most recent first)
    sortedGroups.forEach(g =>
        g.entries.sort((a, b) => (b.dateWorked || '').localeCompare(a.dateWorked || ''))
    );

    contentEl.innerHTML = sortedGroups.map(group => {
        const totalLabel = group.total % 1 === 0 ? group.total : group.total.toFixed(1);
        const entriesHtml = group.entries.map(entry => {
            const dateWorked = entry.dateWorked
                ? new Date(entry.dateWorked).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                : '—';
            const grantedOn = entry.grantedDate
                ? new Date(entry.grantedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                : '';
            const daysLabel = entry.days % 1 === 0 ? entry.days : entry.days.toFixed(1);
            return `
                <div class="toil-entry">
                    <div class="toil-entry-date">${dateWorked}</div>
                    <div class="toil-entry-days">+${daysLabel}</div>
                    <div class="toil-entry-reason">
                        ${entry.reason ? `<span class="label">Reason</span>${entry.reason}` : '<span class="label" style="font-style: italic;">No reason given</span>'}
                    </div>
                    <div class="toil-entry-meta">
                        granted by ${entry.grantedBy || 'unknown'}${grantedOn ? ' · ' + grantedOn : ''}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="toil-emp-group">
                <div class="toil-emp-header">
                    <div class="toil-emp-name">${group.name}</div>
                    <div class="toil-emp-total">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span class="num">${totalLabel}</span> day${group.total === 1 ? '' : 's'} TOIL
                    </div>
                </div>
                <div class="toil-entry-list">${entriesHtml}</div>
            </div>
        `;
    }).join('');
}

// ==================== END TOIL FUNCTIONS ====================

// Report generation functions
function loadReportsSection() {
    const select = document.getElementById('report-employee-select');
    const exportBtn = document.getElementById('export-single-btn');
    
    // Clear existing options
    select.innerHTML = '<option value="">Choose an employee...</option>';
    
    // Populate with employees
    employees.forEach(employee => {
        const option = document.createElement('option');
        option.value = employee.id;
        option.textContent = employee.name;
        select.appendChild(option);
    });
    
    // Add change listener to enable/disable export button
    select.addEventListener('change', function() {
        exportBtn.disabled = !this.value;
    });
}

function generateEmployeeReportData(employeeId) {
    const employee = employees.find(emp => emp.id === employeeId);
    if (!employee) return null;
    
    const employeeRequests = holidayRequests.filter(req => req.employeeId === employeeId);
    const today = new Date().toISOString().split('T')[0];
    
    // Calculate statistics by type
    const holidayReqs = employeeRequests.filter(req => !req.requestType || req.requestType === 'holiday');
    const sickRequests = employeeRequests.filter(req => req.requestType === 'sick');
    const bereavementRequests = employeeRequests.filter(req => req.requestType === 'bereavement');
    const blockBookingReqs = employeeRequests.filter(req => req.isBlockBooking);
    
    const approvedRequests = employeeRequests.filter(req => req.status === 'approved');
    const pendingRequests = employeeRequests.filter(req => req.status === 'pending');
    const rejectedRequests = employeeRequests.filter(req => req.status === 'rejected');
    const cancelledRequests = employeeRequests.filter(req => req.status === 'cancelled');
    
    const totalDaysRequested = employeeRequests.reduce((sum, req) => sum + req.days, 0);
    const approvedDays = approvedRequests.reduce((sum, req) => sum + req.days, 0);
    const pendingDays = pendingRequests.reduce((sum, req) => sum + req.days, 0);
    
    // Find upcoming requests
    const upcomingRequests = approvedRequests.filter(req => req.startDate >= today)
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    
    // Find past requests
    const pastRequests = approvedRequests.filter(req => req.endDate < today)
        .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    
    return {
        employee,
        stats: {
            totalRequests: employeeRequests.length,
            approvedCount: approvedRequests.length,
            pendingCount: pendingRequests.length,
            rejectedCount: rejectedRequests.length,
            cancelledCount: cancelledRequests.length,
            holidayCount: holidayReqs.length,
            sickCount: sickRequests.length,
            bereavementCount: bereavementRequests.length,
            blockBookingCount: blockBookingReqs.length,
            totalDaysRequested,
            approvedDays,
            pendingDays,
            remainingDays: employee.totalAllowance - employee.usedDays,
            toilEarned: employee.toilEarned || 0,
            toilEntryCount: (employee.toilHistory || []).length
        },
        upcomingRequests,
        pastRequests,
        allRequests: employeeRequests.sort((a, b) => new Date(b.submittedDate) - new Date(a.submittedDate)),
        toilHistory: (employee.toilHistory || [])
            .slice()
            .sort((a, b) => new Date(b.dateWorked) - new Date(a.dateWorked))
    };
}

function generateReportHTML(reportData, isAllEmployees = false) {
    const currentDate = new Date().toLocaleDateString('en-GB');
    
    if (isAllEmployees) {
        let html = `
            <html>
            <head>
                <title>All Employees Report - ${currentYear}</title>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; color: #333; }
                    .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #258bca; padding-bottom: 20px; }
                    .employee-section { margin-bottom: 40px; padding: 20px; border: 1px solid #e9ecef; border-radius: 8px; page-break-inside: avoid; }
                    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 20px 0; }
                    .stat-card { background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; }
                    .stat-value { font-size: 1.5em; font-weight: bold; color: #258bca; }
                    .requests-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                    .requests-table th, .requests-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    .requests-table th { background-color: #258bca; color: white; }
                    .status { padding: 4px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold; text-transform: uppercase; }
                    .status.approved { background: #d4edda; color: #155724; }
                    .status.pending { background: #fff3cd; color: #856404; }
                    .status.rejected { background: #f8d7da; color: #721c24; }
                    .status.cancelled { background: #e2e3e5; color: #383d41; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Holiday Management System - All Employees Report (${currentYear})</h1>
                    <p>Generated on: ${currentDate}</p>
                </div>
        `;
        
        reportData.forEach(data => {
            html += generateEmployeeSectionHTML(data);
        });
        
        html += `</body></html>`;
        return html;
    } else {
        let html = `
            <html>
            <head>
                <meta charset="UTF-8">
                <title>${reportData.employee.name} - Report ${currentYear}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; color: #333; }
                    .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #258bca; padding-bottom: 20px; }
                    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 20px 0; }
                    .stat-card { background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; }
                    .stat-value { font-size: 1.5em; font-weight: bold; color: #258bca; }
                    .section { margin: 30px 0; }
                    .requests-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                    .requests-table th, .requests-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    .requests-table th { background-color: #258bca; color: white; }
                    .status { padding: 4px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold; text-transform: uppercase; }
                    .status.approved { background: #d4edda; color: #155724; }
                    .status.pending { background: #fff3cd; color: #856404; }
                    .status.rejected { background: #f8d7da; color: #721c24; }
                    .status.cancelled { background: #e2e3e5; color: #383d41; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>🏖️ Employee Report: ${reportData.employee.name} (${currentYear})</h1>
                    <p>Generated on: ${currentDate}</p>
                </div>
        `;
        
        html += generateEmployeeSectionHTML(reportData, false);
        html += `</body></html>`;
        return html;
    }
}

function generateEmployeeSectionHTML(data, isSection = true) {
    const { employee, stats, upcomingRequests, pastRequests, allRequests } = data;
    
    let html = isSection ? `<div class="employee-section"><h2>${employee.name}</h2>` : '';
    
    html += `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${employee.totalAllowance}</div>
                <div>Total Allowance</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${employee.usedDays}</div>
                <div>Days Used</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.remainingDays}</div>
                <div>Days Remaining</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.totalRequests}</div>
                <div>Total Requests</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.holidayCount}</div>
                <div>Holidays</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.sickCount}</div>
                <div>Sick Days</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.bereavementCount}</div>
                <div>Bereavement</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.blockBookingCount}</div>
                <div>Block Bookings</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.approvedCount}</div>
                <div>Approved</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.pendingCount}</div>
                <div>Pending</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.toilEarned}</div>
                <div>TOIL Earned</div>
            </div>
        </div>
    `;
    
    if (upcomingRequests.length > 0) {
        html += `
            <div class="section">
                <h3>📅 Upcoming Leave</h3>
                <table class="requests-table">
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th>Start Date</th>
                            <th>End Date</th>
                            <th>Days</th>
                            <th>Reason</th>
                            <th>Block Booking</th>
                            <th>Deducted</th>
                            <th>Authorised By</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        upcomingRequests.forEach(request => {
            let dayText;
            if (request.isHalfDay) {
                dayText = `${request.days} (${request.halfDayPeriod} half-day)`;
            } else {
                dayText = request.days.toString();
            }
            
            const requestType = request.requestType || 'holiday';
            const typeText = requestType === 'holiday' ? 'Holiday' : 
                            requestType === 'sick' ? 'Sick Leave' : 'Bereavement Leave';
            
            const authorisedByText = request.approvedBy
                ? `${request.approvedBy}${request.approvedDate ? ` (${request.approvedDate})` : ''}`
                : '—';

            html += `
                <tr>
                    <td>${typeText}</td>
                    <td>${request.startDate}</td>
                    <td>${request.endDate}</td>
                    <td>${dayText}</td>
                    <td>${request.reason || 'Not specified'}</td>
                    <td>${request.isBlockBooking ? 'Yes' : 'No'}</td>
                    <td>${request.deductFromHoliday ? 'Yes' : 'No'}</td>
                    <td>${authorisedByText}</td>
                </tr>
            `;
        });
        
        html += `</tbody></table></div>`;
    }
    
    if (allRequests.length > 0) {
        html += `
            <div class="section">
                <h3>📋 All Requests</h3>
                <table class="requests-table">
                    <thead>
                        <tr>
                            <th>Submitted</th>
                            <th>Type</th>
                            <th>Start Date</th>
                            <th>End Date</th>
                            <th>Days</th>
                            <th>Reason</th>
                            <th>Status</th>
                            <th>Block Booking</th>
                            <th>Deducted</th>
                            <th>Action By</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        allRequests.forEach(request => {
            let dayText;
            if (request.isHalfDay) {
                dayText = `${request.days} (${request.halfDayPeriod} half-day)`;
            } else {
                dayText = request.days.toString();
            }
            
            const requestType = request.requestType || 'holiday';
            const typeText = requestType === 'holiday' ? 'Holiday' : 
                            requestType === 'sick' ? 'Sick Leave' : 'Bereavement Leave';

            let actionByText = '—';
            if (request.status === 'approved' && request.approvedBy) {
                actionByText = `✅ ${request.approvedBy}${request.approvedDate ? ` (${request.approvedDate})` : ''}`;
            } else if (request.status === 'rejected' && request.rejectedBy) {
                actionByText = `❌ ${request.rejectedBy}${request.rejectedDate ? ` (${request.rejectedDate})` : ''}`;
            } else if (request.status === 'cancelled' && request.cancelledBy) {
                actionByText = `🚫 ${request.cancelledBy}${request.cancelledDate ? ` (${request.cancelledDate})` : ''}`;
            }

            html += `
                <tr>
                    <td>${request.submittedDate}</td>
                    <td>${typeText}</td>
                    <td>${request.startDate}</td>
                    <td>${request.endDate}</td>
                    <td>${dayText}</td>
                    <td>${request.reason || 'Not specified'}</td>
                    <td><span class="status ${request.status}">${request.status}</span></td>
                    <td>${request.isBlockBooking ? 'Yes' : 'No'}</td>
                    <td>${request.deductFromHoliday ? 'Yes' : 'No'}</td>
                    <td>${actionByText}</td>
                </tr>
            `;
        });
        
        html += `</tbody></table></div>`;
    }
    
    const toilHistory = data.toilHistory || [];
    if (toilHistory.length > 0) {
        html += `
            <div class="section">
                <h3>TOIL Log</h3>
                <p style="color:#6c757d; margin: 0 0 12px 0;">Total TOIL earned this year: <strong>${toilHistory.reduce((sum, e) => sum + (e.days || 0), 0)} day(s)</strong> across ${toilHistory.length} entr${toilHistory.length === 1 ? 'y' : 'ies'}.</p>
                <table class="requests-table">
                    <thead>
                        <tr>
                            <th>Date Worked</th>
                            <th>Days</th>
                            <th>Reason</th>
                            <th>Granted By</th>
                            <th>Granted On</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        toilHistory.forEach(entry => {
            const grantedByText = entry.grantedBy
                ? `${entry.grantedBy}${entry.grantedDate ? ` (${entry.grantedDate})` : ''}`
                : '—';
            html += `
                <tr>
                    <td>${entry.dateWorked || '—'}</td>
                    <td>${entry.days}</td>
                    <td>${entry.reason || 'Not specified'}</td>
                    <td>${entry.grantedBy || '—'}</td>
                    <td>${entry.grantedDate || '—'}</td>
                </tr>
            `;
        });
        html += `</tbody></table></div>`;
    }
    
    if (isSection) {
        html += `</div>`;
    }
    
    return html;
}

function exportEmployeeReport() {
    const selectElement = document.getElementById('report-employee-select');
    const selectedEmployeeId = parseInt(selectElement.value);
    
    if (!selectedEmployeeId) {
        toast.warning('Please select an employee first.');
        return;
    }
    
    const reportData = generateEmployeeReportData(selectedEmployeeId);
    if (!reportData) {
        toast.error('Employee not found.');
        return;
    }
    
    const html = generateReportHTML(reportData);
    downloadHTML(html, `${reportData.employee.name}_Report_${currentYear}_${new Date().toISOString().split('T')[0]}.html`);
}

function exportAllEmployeesReport() {
    if (employees.length === 0) {
        toast.warning('No employees found.');
        return;
    }
    
    const allReportData = employees.map(employee => generateEmployeeReportData(employee.id));
    const html = generateReportHTML(allReportData, true);
    downloadHTML(html, `All_Employees_Report_${currentYear}_${new Date().toISOString().split('T')[0]}.html`);
}

function downloadHTML(html, filename) {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== ANALYTICS FUNCTIONS ====================

function refreshAnalytics() {
    const analyticsYear = parseInt(document.getElementById('analytics-year-select').value);
    
    // Calculate all analytics
    calculateKeyMetrics(analyticsYear);
    renderMonthlyChart(analyticsYear);
    renderRequestTypeChart(analyticsYear);
    renderStatusChart(analyticsYear);
    renderCoverageHeatmap(analyticsYear);
    renderEmployeeUtilization(analyticsYear);
    renderBusiestMonths(analyticsYear);
    renderKeyInsights(analyticsYear);
    renderForecasting(analyticsYear);
    renderYearComparison(analyticsYear);
}

function calculateKeyMetrics(year) {
    const yearRequests = holidayRequests.filter(req => {
        const reqYear = new Date(req.startDate).getFullYear();
        return reqYear === year && req.status === 'approved';
    });
    
    const totalDays = yearRequests.reduce((sum, req) => sum + (req.days || 0), 0);
    const totalRequests = yearRequests.length;
    const avgDays = employees.length > 0 ? (totalDays / employees.length).toFixed(1) : 0;
    
    // Calculate approval rate
    const allRequestsInYear = holidayRequests.filter(req => {
        const reqYear = new Date(req.startDate).getFullYear();
        return reqYear === year;
    });
    const approvalRate = allRequestsInYear.length > 0 
        ? ((yearRequests.length / allRequestsInYear.length) * 100).toFixed(1) 
        : 0;
    
    document.getElementById('analytics-total-days').textContent = totalDays;
    document.getElementById('analytics-avg-days').textContent = avgDays;
    document.getElementById('analytics-total-requests').textContent = totalRequests;
    document.getElementById('analytics-approval-rate').textContent = approvalRate + '%';
}

function renderMonthlyChart(year) {
    const monthlyData = Array(12).fill(0);
    const monthRequests = Array(12).fill(0);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    holidayRequests.filter(req => {
        const reqYear = new Date(req.startDate).getFullYear();
        return reqYear === year && req.status === 'approved';
    }).forEach(req => {
        const month = new Date(req.startDate).getMonth();
        monthlyData[month] += req.days || 0;
        monthRequests[month] += 1;
    });

    const maxValue   = Math.max(...monthlyData);
    const totalDays  = monthlyData.reduce((s, d) => s + d, 0);
    const container  = document.getElementById('monthly-chart');

    // Empty state if zero data this year
    if (totalDays === 0) {
        renderEmptyState(container, {
            icon: 'calendar',
            title: 'No usage yet',
            description: `No approved holidays in ${year} so far. Once requests are approved, monthly trends will appear here.`
        });
        return;
    }

    // Absolute pixel heights — sidesteps the % height-in-flex bug entirely.
    // The chart container is 300px tall in the markup; reserve ~50px for labels
    // and the optional value row, giving the tallest bar ~220px to play with.
    const PLOT_HEIGHT = 220;

    let html = '<div class="monthly-chart-bars">';
    monthlyData.forEach((days, index) => {
        const heightPx = days > 0 ? Math.max(6, Math.round((days / maxValue) * PLOT_HEIGHT)) : 4;
        const reqCount = monthRequests[index];
        const valueLabel = days > 0 ? (days % 1 === 0 ? days : days.toFixed(1)) : '';
        const tooltip = days > 0
            ? `${monthNames[index]}: ${valueLabel} day${days === 1 ? '' : 's'} across ${reqCount} request${reqCount === 1 ? '' : 's'}`
            : `${monthNames[index]}: no approved leave`;

        html += `
            <div class="monthly-bar-col" title="${tooltip}">
                <div class="monthly-bar-stack">
                    ${days > 0 ? `<div class="monthly-bar-value">${valueLabel}</div>` : ''}
                    <div class="monthly-bar ${days === 0 ? 'is-empty' : ''}" style="height: ${heightPx}px;"></div>
                </div>
                <div class="monthly-bar-label">${monthNames[index]}</div>
            </div>
        `;
    });
    html += '</div>';

    container.innerHTML = html;
}

function renderRequestTypeChart(year) {
    const types = { holiday: 0, sick: 0, bereavement: 0 };
    
    holidayRequests.filter(req => {
        const reqYear = new Date(req.startDate).getFullYear();
        return reqYear === year && req.status === 'approved';
    }).forEach(req => {
        const type = req.requestType || 'holiday';
        types[type] = (types[type] || 0) + 1;
    });
    
    const total = Object.values(types).reduce((a, b) => a + b, 0);
    const colors = {
        holiday: '#667eea',
        sick: '#f093fb',
        bereavement: '#4facfe'
    };
    
    let html = '<div style="display: flex; flex-direction: column; gap: 15px;">';
    Object.entries(types).forEach(([type, count]) => {
        const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
        html += `
            <div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span style="font-weight: 500; text-transform: capitalize;">${type}</span>
                    <span style="font-weight: 600;">${count} (${percentage}%)</span>
                </div>
                <div style="background: #f0f0f0; height: 30px; border-radius: 15px; overflow: hidden;">
                    <div style="background: ${colors[type]}; height: 100%; width: ${percentage}%; transition: width 0.3s ease;"></div>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    document.getElementById('request-type-chart').innerHTML = html;
}

function renderStatusChart(year) {
    const statuses = { approved: 0, pending: 0, rejected: 0, cancelled: 0 };
    
    holidayRequests.filter(req => {
        const reqYear = new Date(req.startDate).getFullYear();
        return reqYear === year;
    }).forEach(req => {
        statuses[req.status] = (statuses[req.status] || 0) + 1;
    });
    
    const total = Object.values(statuses).reduce((a, b) => a + b, 0);
    const colors = {
        approved: '#28a745',
        pending: '#ffc107',
        rejected: '#dc3545',
        cancelled: '#6c757d'
    };
    
    let html = '<div style="display: flex; flex-direction: column; gap: 15px;">';
    Object.entries(statuses).forEach(([status, count]) => {
        const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
        html += `
            <div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span style="font-weight: 500; text-transform: capitalize;">${status}</span>
                    <span style="font-weight: 600;">${count} (${percentage}%)</span>
                </div>
                <div style="background: #f0f0f0; height: 30px; border-radius: 15px; overflow: hidden;">
                    <div style="background: ${colors[status]}; height: 100%; width: ${percentage}%; transition: width 0.3s ease;"></div>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    document.getElementById('status-chart').innerHTML = html;
}

function renderCoverageHeatmap(year) {
    const dailyCoverage = {};
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    // Calculate coverage for each day
    holidayRequests.filter(req => {
        const reqYear = new Date(req.startDate).getFullYear();
        return reqYear === year && req.status === 'approved';
    }).forEach(req => {
        const start = new Date(req.startDate);
        const end = new Date(req.endDate);
        
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateKey = d.toISOString().split('T')[0];
            dailyCoverage[dateKey] = (dailyCoverage[dateKey] || 0) + 1;
        }
    });
    
    const totalEmployees = employees.length;
    const coverageByMonth = {};
    
    Object.entries(dailyCoverage).forEach(([date, count]) => {
        const month = new Date(date).getMonth();
        if (!coverageByMonth[month]) coverageByMonth[month] = [];
        coverageByMonth[month].push(totalEmployees - count);
    });
    
    let html = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">';
    
    for (let month = 0; month < 12; month++) {
        const availabilities = coverageByMonth[month] || [];
        const avgAvailable = availabilities.length > 0 
            ? (availabilities.reduce((a, b) => a + b, 0) / availabilities.length).toFixed(1)
            : totalEmployees;
        const minAvailable = availabilities.length > 0 ? Math.min(...availabilities) : totalEmployees;
        
        const coverage = totalEmployees > 0 ? ((avgAvailable / totalEmployees) * 100) : 100;
        const color = coverage >= 80 ? '#28a745' : coverage >= 60 ? '#ffc107' : '#dc3545';
        
        html += `
            <div style="background: white; border: 2px solid ${color}; border-radius: 8px; padding: 12px; text-align: center;">
                <div style="font-size: 12px; font-weight: 500; color: #666; margin-bottom: 5px;">${monthNames[month]}</div>
                <div style="font-size: 24px; font-weight: 700; color: ${color};">${avgAvailable}</div>
                <div style="font-size: 11px; color: #999;">avg available</div>
                <div style="font-size: 11px; color: #999; margin-top: 3px;">min: ${minAvailable}</div>
            </div>
        `;
    }
    
    html += '</div>';
    document.getElementById('coverage-heatmap').innerHTML = html;
}

function renderEmployeeUtilization(year) {
    const utilization = employees.map(emp => {
        const empRequests = holidayRequests.filter(req => {
            const reqYear = new Date(req.startDate).getFullYear();
            return req.employeeId === emp.id && reqYear === year && req.status === 'approved';
        });
        
        const used = empRequests.reduce((sum, req) => sum + (req.days || 0), 0);
        const percentage = emp.totalAllowance > 0 ? (used / emp.totalAllowance * 100) : 0;
        
        return {
            name: emp.name,
            used,
            total: emp.totalAllowance,
            percentage: percentage.toFixed(1),
            remaining: emp.totalAllowance - used
        };
    }).sort((a, b) => b.percentage - a.percentage);
    
    let html = '<div style="display: flex; flex-direction: column; gap: 12px;">';
    utilization.forEach(emp => {
        const color = emp.percentage >= 80 ? '#28a745' : emp.percentage >= 50 ? '#ffc107' : '#6c757d';
        html += `
            <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid ${color};">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-weight: 500;">${emp.name}</span>
                    <span style="font-weight: 600; color: ${color};">${emp.percentage}%</span>
                </div>
                <div style="background: #e9ecef; height: 20px; border-radius: 10px; overflow: hidden; margin-bottom: 5px;">
                    <div style="background: ${color}; height: 100%; width: ${emp.percentage}%; transition: width 0.3s ease;"></div>
                </div>
                <div style="font-size: 13px; color: #666;">
                    Used: ${emp.used} days | Remaining: ${emp.remaining} days | Total: ${emp.total} days
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    document.getElementById('employee-utilization').innerHTML = html;
}

function renderBusiestMonths(year) {
    const monthlyData = Array(12).fill(0);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    holidayRequests.filter(req => {
        const reqYear = new Date(req.startDate).getFullYear();
        return reqYear === year && req.status === 'approved';
    }).forEach(req => {
        const month = new Date(req.startDate).getMonth();
        monthlyData[month] += req.days || 0;
    });
    
    const monthsWithData = monthlyData.map((days, index) => ({ month: monthNames[index], days, index }))
        .filter(m => m.days > 0)
        .sort((a, b) => b.days - a.days)
        .slice(0, 5);
    
    let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
    monthsWithData.forEach((data, rank) => {
        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
        html += `
            <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: #f8f9fa; border-radius: 8px;">
                <span style="font-size: 24px;">${medals[rank]}</span>
                <div style="flex: 1;">
                    <div style="font-weight: 500;">${data.month}</div>
                    <div style="font-size: 13px; color: #666;">${data.days} days taken</div>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    document.getElementById('busiest-months').innerHTML = html || '<p style="color: #999;">No data available</p>';
}

function renderKeyInsights(year) {
    const approvedRequests = holidayRequests.filter(req => {
        const reqYear = new Date(req.startDate).getFullYear();
        return reqYear === year && req.status === 'approved';
    });
    
    // Calculate average request length
    const avgLength = approvedRequests.length > 0
        ? (approvedRequests.reduce((sum, req) => sum + (req.days || 0), 0) / approvedRequests.length).toFixed(1)
        : 0;
    
    // Find most popular day of week
    const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0];
    approvedRequests.forEach(req => {
        const dayOfWeek = new Date(req.startDate).getDay();
        dayOfWeekCounts[dayOfWeek]++;
    });
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const mostPopularDay = daysOfWeek[dayOfWeekCounts.indexOf(Math.max(...dayOfWeekCounts))];
    
    // Block bookings percentage
    const blockBookings = approvedRequests.filter(req => req.isBlockBooking).length;
    const blockPercentage = approvedRequests.length > 0 
        ? ((blockBookings / approvedRequests.length) * 100).toFixed(1)
        : 0;
    
    let html = `
        <div style="display: flex; flex-direction: column; gap: 15px;">
            <div style="padding: 12px; background: #f8f9fa; border-radius: 8px; border-left: 3px solid #667eea;">
                <div style="font-size: 13px; color: #666; margin-bottom: 3px;">Average Request Length</div>
                <div style="font-size: 20px; font-weight: 600; color: #333;">${avgLength} days</div>
            </div>
            <div style="padding: 12px; background: #f8f9fa; border-radius: 8px; border-left: 3px solid #f093fb;">
                <div style="font-size: 13px; color: #666; margin-bottom: 3px;">Most Popular Start Day</div>
                <div style="font-size: 20px; font-weight: 600; color: #333;">${mostPopularDay}</div>
            </div>
            <div style="padding: 12px; background: #f8f9fa; border-radius: 8px; border-left: 3px solid #4facfe;">
                <div style="font-size: 13px; color: #666; margin-bottom: 3px;">Block Bookings</div>
                <div style="font-size: 20px; font-weight: 600; color: #333;">${blockPercentage}%</div>
            </div>
        </div>
    `;
    
    document.getElementById('key-insights').innerHTML = html;
}

function renderForecasting(year) {
    const today = new Date();
    const currentYear = today.getFullYear();
    
    if (year !== currentYear) {
        document.getElementById('forecasting').innerHTML = '<p style="color: #999;">Forecasting only available for current year</p>';
        return;
    }
    
    const dayOfYear = Math.floor((today - new Date(year, 0, 0)) / 1000 / 60 / 60 / 24);
    const daysInYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0) ? 366 : 365;
    const progressPercentage = ((dayOfYear / daysInYear) * 100).toFixed(1);
    
    // Calculate usage so far
    const usedSoFar = holidayRequests.filter(req => {
        const reqYear = new Date(req.startDate).getFullYear();
        const reqDate = new Date(req.startDate);
        return reqYear === year && reqDate <= today && req.status === 'approved';
    }).reduce((sum, req) => sum + (req.days || 0), 0);
    
    // Calculate total allowance
    const totalAllowance = employees.reduce((sum, emp) => sum + emp.totalAllowance, 0);
    const currentUsageRate = totalAllowance > 0 ? ((usedSoFar / totalAllowance) * 100).toFixed(1) : 0;
    
    // Projected year-end usage
    const projectedTotal = progressPercentage > 0 ? (usedSoFar / (progressPercentage / 100)).toFixed(0) : 0;
    const projectedPercentage = totalAllowance > 0 ? ((projectedTotal / totalAllowance) * 100).toFixed(1) : 0;
    
    let html = `
        <div style="display: flex; flex-direction: column; gap: 15px;">
            <div style="padding: 12px; background: #f8f9fa; border-radius: 8px; border-left: 3px solid #43e97b;">
                <div style="font-size: 13px; color: #666; margin-bottom: 3px;">Year Progress</div>
                <div style="font-size: 20px; font-weight: 600; color: #333;">${progressPercentage}%</div>
            </div>
            <div style="padding: 12px; background: #f8f9fa; border-radius: 8px; border-left: 3px solid #667eea;">
                <div style="font-size: 13px; color: #666; margin-bottom: 3px;">Current Usage Rate</div>
                <div style="font-size: 20px; font-weight: 600; color: #333;">${currentUsageRate}%</div>
            </div>
            <div style="padding: 12px; background: #f8f9fa; border-radius: 8px; border-left: 3px solid #f093fb;">
                <div style="font-size: 13px; color: #666; margin-bottom: 3px;">Projected Year-End</div>
                <div style="font-size: 20px; font-weight: 600; color: #333;">${projectedPercentage}%</div>
                <div style="font-size: 11px; color: #999; margin-top: 3px;">${projectedTotal} of ${totalAllowance} days</div>
            </div>
        </div>
    `;
    
    document.getElementById('forecasting').innerHTML = html;
}

function renderYearComparison(year) {
    const years = [year - 2, year - 1, year];
    const comparisonData = years.map(y => {
        const yearRequests = holidayRequests.filter(req => {
            const reqYear = new Date(req.startDate).getFullYear();
            return reqYear === y && req.status === 'approved';
        });
        
        const totalDays = yearRequests.reduce((sum, req) => sum + (req.days || 0), 0);
        const avgPerEmployee = employees.length > 0 ? (totalDays / employees.length).toFixed(1) : 0;
        
        return {
            year: y,
            totalDays,
            requests: yearRequests.length,
            avgPerEmployee
        };
    });
    
    let html = '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">';
    comparisonData.forEach(data => {
        const isCurrentYear = data.year === year;
        html += `
            <div style="background: ${isCurrentYear ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#f8f9fa'}; 
                        color: ${isCurrentYear ? 'white' : '#333'}; 
                        padding: 20px; 
                        border-radius: 12px; 
                        text-align: center;
                        ${isCurrentYear ? 'box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);' : ''}">
                <div style="font-size: 18px; font-weight: 600; margin-bottom: 15px; ${isCurrentYear ? '' : 'color: #666;'}">${data.year}</div>
                <div style="margin-bottom: 10px;">
                    <div style="font-size: 28px; font-weight: 700;">${data.totalDays}</div>
                    <div style="font-size: 12px; opacity: 0.8;">Total Days</div>
                </div>
                <div style="margin-bottom: 10px;">
                    <div style="font-size: 20px; font-weight: 600;">${data.requests}</div>
                    <div style="font-size: 12px; opacity: 0.8;">Requests</div>
                </div>
                <div>
                    <div style="font-size: 20px; font-weight: 600;">${data.avgPerEmployee}</div>
                    <div style="font-size: 12px; opacity: 0.8;">Avg per Employee</div>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    document.getElementById('year-comparison').innerHTML = html;
}

// ==================== END ANALYTICS FUNCTIONS ====================

// Initialize app when page loads
document.addEventListener('DOMContentLoaded', init);

// Add event listeners for date inputs to update preview
document.addEventListener('DOMContentLoaded', () => {
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    
    if (startDateInput) {
        startDateInput.addEventListener('change', () => {
            const halfDayToggle = document.getElementById('half-day-toggle');
            if (halfDayToggle && halfDayToggle.checked) {
                document.getElementById('end-date').value = startDateInput.value;
            }
            updateDaysPreview();
        });
    }
    
    if (endDateInput) {
        endDateInput.addEventListener('change', updateDaysPreview);
    }

    // Employee portal toolbar — search, sort, filter chips
    const empSearch = document.getElementById('employee-search');
    if (empSearch) {
        empSearch.addEventListener('input', filterEmployeeCards);
    }

    const empSearchClear = document.getElementById('emp-search-clear');
    if (empSearchClear) {
        empSearchClear.addEventListener('click', () => {
            const input = document.getElementById('employee-search');
            if (input) input.value = '';
            filterEmployeeCards();
            input?.focus();
        });
    }

    const empSort = document.getElementById('employee-sort');
    if (empSort) {
        empSort.value = EMP_VIEW_STATE.sort;
        empSort.addEventListener('change', () => {
            EMP_VIEW_STATE.sort = empSort.value;
            persistEmpViewState();
            populateEmployeeCards();
        });
    }

    document.querySelectorAll('.filter-chip[data-filter]').forEach(chip => {
        // Restore active state from persisted filter
        chip.classList.toggle('active', chip.dataset.filter === EMP_VIEW_STATE.filter);
        chip.addEventListener('click', () => {
            EMP_VIEW_STATE.filter = chip.dataset.filter;
            persistEmpViewState();
            document.querySelectorAll('.filter-chip[data-filter]').forEach(c => {
                c.classList.toggle('active', c.dataset.filter === EMP_VIEW_STATE.filter);
            });
            populateEmployeeCards();
        });
    });

    // TOIL grant modal — live preview + employee search
    const toilDaysInput = document.getElementById('toil-days');
    if (toilDaysInput) toilDaysInput.addEventListener('input', updateToilPreview);

    const toilSearch = document.getElementById('toil-emp-search');
    if (toilSearch) toilSearch.addEventListener('input', renderToilEmployeeGrid);

    // Close TOIL modal on backdrop click
    const toilModal = document.getElementById('toil-grant-modal');
    if (toilModal) {
        toilModal.addEventListener('click', (e) => {
            if (e.target === toilModal) closeToilGrantModal();
        });
    }
});

// ==================== PIN keypad wiring ====================
// On-screen keypad
document.querySelectorAll('.pin-key[data-digit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        appendPinDigit(btn.dataset.digit);
    });
});

const pinBackBtn = document.getElementById('pin-key-back');
if (pinBackBtn) pinBackBtn.addEventListener('click', backspacePin);

const pinCancelBtn = document.getElementById('pin-key-cancel');
if (pinCancelBtn) pinCancelBtn.addEventListener('click', closePinModal);

// Physical keyboard support — keep the hidden input listening for digits/backspace/Enter
document.getElementById('pin-input').addEventListener('input', (e) => {
    // Strip non-digits and clamp to 4 chars
    const cleaned = e.target.value.replace(/\D/g, '').slice(0, 4);
    e.target.value = cleaned;
    updatePinDots();
    if (cleaned.length === 4) {
        setTimeout(checkPin, 120);
    }
});

document.getElementById('pin-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (this.value.length === 4) checkPin();
    } else if (e.key === 'Escape') {
        closePinModal();
    }
});

// Close PIN modal when clicking the dimmed backdrop
document.getElementById('pin-modal').addEventListener('click', (e) => {
    if (e.target.id === 'pin-modal') {
        closePinModal();
    }
});

// Close modals when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.calendar-day') && !e.target.closest('.popover')) {
        closePopover();
    }
    
    // Close employee modal when clicking outside
    if (e.target.classList.contains('modal')) {
        closeEmployeeModal();
    }
});
// ==================== ATTENDANCE REVIEW ====================
// Individual attendance review for 1-on-1 meetings.
// Surfaces total days off, sick day patterns, short-notice bookings, and cancellations.

let currentAttendanceEmployeeId = null;
let attendanceReviewYear = null;

function loadAttendanceReview() {
    const yearSelect = document.getElementById('attendance-year-select');
    if (!yearSelect) return;

    // Populate year selector if not already
    if (!yearSelect.dataset.populated) {
        const currentActualYear = new Date().getFullYear();
        for (let y = currentActualYear - 3; y <= currentActualYear + 1; y++) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            if (y === currentYear) opt.selected = true;
            yearSelect.appendChild(opt);
        }
        yearSelect.dataset.populated = 'true';
        attendanceReviewYear = currentYear;
    }

    if (attendanceReviewYear === null) attendanceReviewYear = currentYear;

    // Show list, hide detail
    document.getElementById('attendance-list-view').classList.remove('hidden');
    document.getElementById('attendance-detail-view').classList.add('hidden');
    currentAttendanceEmployeeId = null;

    renderAttendanceEmployeeList();
}

function changeAttendanceYear() {
    attendanceReviewYear = parseInt(document.getElementById('attendance-year-select').value);
    if (currentAttendanceEmployeeId) {
        showAttendanceDetail(currentAttendanceEmployeeId);
    } else {
        renderAttendanceEmployeeList();
    }
}

function filterAttendanceList() {
    renderAttendanceEmployeeList();
}

function renderAttendanceEmployeeList() {
    const container = document.getElementById('attendance-employee-grid');
    if (!container) return;

    const searchEl = document.getElementById('attendance-search');
    const searchTerm = (searchEl?.value || '').toLowerCase();

    const filtered = employees.filter(emp => emp.name.toLowerCase().includes(searchTerm));

    if (filtered.length === 0) {
        if (searchTerm) {
            renderEmptyState(container, {
                icon: 'search',
                title: 'No matches',
                description: `No employees match "${searchTerm}". Try a different search term.`
            });
        } else {
            renderEmptyState(container, {
                icon: 'users',
                title: 'No employees',
                description: 'Add employees from the Employee Management section to review their attendance here.'
            });
        }
        return;
    }

    container.innerHTML = filtered.map(employee => {
        const stats = getAttendanceStats(employee.id, attendanceReviewYear);

        // Concern flags for at-a-glance triage
        const flags = [];
        if (stats.shortNoticeCount >= 3) flags.push(`<span class="att-flag flag-amber">${stats.shortNoticeCount} short notice</span>`);
        if (stats.sameDayCount >= 1) flags.push(`<span class="att-flag flag-red">${stats.sameDayCount} same day</span>`);
        if (stats.mondayFridaySickPercent >= 60 && stats.sickOccurrences >= 2) {
            flags.push(`<span class="att-flag flag-amber">${stats.mondayFridaySickPercent}% Mon/Fri sick</span>`);
        }
        if (stats.sickDays >= 7) flags.push(`<span class="att-flag flag-red">${stats.sickDays} sick days</span>`);
        if (stats.cancelledCount >= 3) flags.push(`<span class="att-flag flag-grey">${stats.cancelledCount} cancellations</span>`);

        return `
            <div class="att-card" onclick="showAttendanceDetail(${employee.id})">
                <div class="att-card-top">
                    <div class="att-card-name">${escapeAttHtml(employee.name)}</div>
                    <button class="btn-small" onclick="event.stopPropagation(); showAttendanceDetail(${employee.id})">Review →</button>
                </div>
                <div class="att-card-stats">
                    <div class="att-mini"><div class="att-mini-val">${stats.totalDaysOff}</div><div class="att-mini-lbl">Days off</div></div>
                    <div class="att-mini"><div class="att-mini-val">${stats.holidayDays}</div><div class="att-mini-lbl">Holiday</div></div>
                    <div class="att-mini"><div class="att-mini-val tone-red">${stats.sickDays}</div><div class="att-mini-lbl">Sick</div></div>
                    <div class="att-mini"><div class="att-mini-val tone-red">${stats.sickOccurrences}</div><div class="att-mini-lbl">Sick occ.</div></div>
                    <div class="att-mini"><div class="att-mini-val">${stats.bereavementDays}</div><div class="att-mini-lbl">Bereav.</div></div>
                    <div class="att-mini"><div class="att-mini-val tone-amber">${stats.shortNoticeCount}</div><div class="att-mini-lbl">Short notice</div></div>
                    <div class="att-mini"><div class="att-mini-val tone-grey">${stats.cancelledCount}</div><div class="att-mini-lbl">Cancelled</div></div>
                </div>
                ${flags.length ? `<div class="att-card-flags">${flags.join('')}</div>` : ''}
            </div>
        `;
    }).join('');
}

function getAttendanceStats(employeeId, year) {
    const employee = employees.find(emp => emp.id === employeeId);
    const allReqs = holidayRequests.filter(req => req.employeeId === employeeId);

    const yearRequests = allReqs.filter(req => {
        return new Date(req.startDate).getFullYear() === year;
    });

    const approved = yearRequests.filter(r => r.status === 'approved');
    const pending = yearRequests.filter(r => r.status === 'pending');
    const cancelled = yearRequests.filter(r => r.status === 'cancelled');
    const rejected = yearRequests.filter(r => r.status === 'rejected');

    const holidayApproved = approved.filter(r => !r.requestType || r.requestType === 'holiday');
    const sickApproved = approved.filter(r => r.requestType === 'sick');
    const bereavementApproved = approved.filter(r => r.requestType === 'bereavement');

    const holidayDays = holidayApproved.reduce((s, r) => s + (r.days || 0), 0);
    const sickDays = sickApproved.reduce((s, r) => s + (r.days || 0), 0);
    const bereavementDays = bereavementApproved.reduce((s, r) => s + (r.days || 0), 0);
    const totalDaysOff = holidayDays + sickDays + bereavementDays;

    // Sick day-of-week pattern
    const sickByDayOfWeek = [0, 0, 0, 0, 0, 0, 0]; // Sun..Sat
    let mondayFridaySickCount = 0;
    sickApproved.forEach(r => {
        const dow = new Date(r.startDate).getDay();
        sickByDayOfWeek[dow]++;
        if (dow === 1 || dow === 5) mondayFridaySickCount++;
    });
    const sickOccurrences = sickApproved.length;
    const mondayFridaySickPercent = sickOccurrences > 0
        ? Math.round((mondayFridaySickCount / sickOccurrences) * 100)
        : 0;

    // Short-notice analysis (holidays only — sick is by definition short notice)
    const shortNoticeRequests = approved.filter(r => {
        if (r.requestType === 'sick' || r.requestType === 'bereavement') return false;
        const n = getDaysNotice(r);
        return n !== null && n >= 0 && n < 7;
    });
    const sameDayRequests = approved.filter(r => {
        if (r.requestType === 'sick' || r.requestType === 'bereavement') return false;
        return getDaysNotice(r) === 0;
    });

    const holidayNotices = holidayApproved
        .map(r => getDaysNotice(r))
        .filter(n => n !== null && n >= 0);
    const avgNoticeDays = holidayNotices.length > 0
        ? Math.round(holidayNotices.reduce((s, n) => s + n, 0) / holidayNotices.length)
        : null;

    return {
        employee,
        year,
        totalRequests: yearRequests.length,
        approvedCount: approved.length,
        pendingCount: pending.length,
        cancelledCount: cancelled.length,
        rejectedCount: rejected.length,
        holidayDays,
        sickDays,
        bereavementDays,
        totalDaysOff,
        sickOccurrences,
        sickByDayOfWeek,
        mondayFridaySickCount,
        mondayFridaySickPercent,
        shortNoticeCount: shortNoticeRequests.length,
        shortNoticeRequests,
        sameDayCount: sameDayRequests.length,
        sameDayRequests,
        avgNoticeDays,
        approvedRequests: approved,
        sickApproved,
        holidayApproved,
        bereavementApproved,
        cancelledRequests: cancelled,
        pendingRequests: pending,
        rejectedRequests: rejected
    };
}

function getDaysNotice(request) {
    if (!request.submittedDate || !request.startDate) return null;
    const submitted = new Date(request.submittedDate + 'T00:00:00');
    const start = new Date(request.startDate + 'T00:00:00');
    return Math.round((start - submitted) / (1000 * 60 * 60 * 24));
}

function showAttendanceDetail(employeeId) {
    currentAttendanceEmployeeId = employeeId;
    const employee = employees.find(emp => emp.id === employeeId);
    if (!employee) return;

    document.getElementById('attendance-list-view').classList.add('hidden');
    const detailView = document.getElementById('attendance-detail-view');
    detailView.classList.remove('hidden');
    detailView.innerHTML = renderAttendanceDetailHTML(employeeId, attendanceReviewYear);
}

function backToAttendanceList() {
    currentAttendanceEmployeeId = null;
    document.getElementById('attendance-list-view').classList.remove('hidden');
    document.getElementById('attendance-detail-view').classList.add('hidden');
    renderAttendanceEmployeeList();
}

function renderAttendanceDetailHTML(employeeId, year) {
    const stats = getAttendanceStats(employeeId, year);
    const employee = stats.employee;
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Discussion points / concerns banner
    const concerns = buildConcernsList(stats);
    const concernsBanner = concerns.length === 0 ? '' : `
        <div class="att-concerns">
            <h4 style="margin: 0 0 10px 0; color: #856404;">💬 Discussion Points</h4>
            <ul style="margin: 0; padding-left: 20px;">
                ${concerns.map(c => `<li>${c}</li>`).join('')}
            </ul>
        </div>
    `;

    // Sick day-of-week chart (weekdays only)
    const maxSickDay = Math.max(...stats.sickByDayOfWeek, 1);
    const sickDayChart = [1, 2, 3, 4, 5].map(idx => {
        const count = stats.sickByDayOfWeek[idx];
        const pct = (count / maxSickDay) * 100;
        const isHotspot = (idx === 1 || idx === 5) && count > 0;
        return `
            <div class="sick-bar-row">
                <div class="sick-bar-label">${dayNames[idx].substring(0,3)}</div>
                <div class="sick-bar-track">
                    <div class="sick-bar-fill ${isHotspot ? 'hotspot' : ''}" style="width:${Math.max(pct, 3)}%"></div>
                </div>
                <div class="sick-bar-count">${count}</div>
            </div>
        `;
    }).join('');

    // Short-notice list
    const shortNoticeHtml = stats.shortNoticeRequests.length === 0
        ? '<p style="color:#6c757d; margin: 0;">No short-notice holiday requests in this period.</p>'
        : stats.shortNoticeRequests
            .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
            .map(r => {
                const notice = getDaysNotice(r);
                const dateRange = r.startDate === r.endDate ? formatAttDate(r.startDate) : `${formatAttDate(r.startDate)} → ${formatAttDate(r.endDate)}`;
                const noticeLabel = notice === 0 ? 'Same day' : `${notice} day${notice === 1 ? '' : 's'} notice`;
                const pillClass = notice === 0 ? 'pill-red' : 'pill-amber';
                return `
                    <div class="att-event-row">
                        <div class="att-event-main">
                            <div><strong>${dateRange}</strong> · ${r.days} day${r.days === 1 ? '' : 's'}</div>
                            ${r.reason ? `<div class="att-muted">${escapeAttHtml(r.reason)}</div>` : ''}
                        </div>
                        <div class="att-event-meta">
                            <div class="att-pill ${pillClass}">${noticeLabel}</div>
                            <div class="att-muted att-small">Submitted ${formatAttDate(r.submittedDate)}</div>
                        </div>
                    </div>
                `;
            }).join('');

    // Sick events list
    const sickEventsHtml = stats.sickApproved.length === 0
        ? '<p style="color:#6c757d; margin: 0;">No sick leave recorded in this period.</p>'
        : stats.sickApproved
            .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
            .map(r => {
                const dateRange = r.startDate === r.endDate ? formatAttDate(r.startDate) : `${formatAttDate(r.startDate)} → ${formatAttDate(r.endDate)}`;
                const dow = new Date(r.startDate).getDay();
                const dayLabel = dayNames[dow];
                const isMonFri = dow === 1 || dow === 5;
                return `
                    <div class="att-event-row">
                        <div class="att-event-main">
                            <div><strong>${dateRange}</strong> · ${r.days} day${r.days === 1 ? '' : 's'}</div>
                            <div class="att-muted">${dayLabel}${r.reason ? ` · ${escapeAttHtml(r.reason)}` : ''}</div>
                        </div>
                        <div class="att-event-meta">
                            ${isMonFri ? `<div class="att-pill pill-amber">${dayLabel}</div>` : ''}
                            ${r.approvedBy ? `<div class="att-muted att-small">Recorded by ${escapeAttHtml(r.approvedBy)}</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

    // Cancelled list
    const cancelledHtml = stats.cancelledRequests.length === 0
        ? ''
        : `
            <div class="att-section">
                <h4>↺ Cancelled Requests (${stats.cancelledRequests.length})</h4>
                ${stats.cancelledRequests
                    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
                    .map(r => {
                        const dateRange = r.startDate === r.endDate ? formatAttDate(r.startDate) : `${formatAttDate(r.startDate)} → ${formatAttDate(r.endDate)}`;
                        const typeLabel = r.requestType === 'sick' ? 'Sick' : r.requestType === 'bereavement' ? 'Bereavement' : 'Holiday';
                        return `
                            <div class="att-event-row">
                                <div class="att-event-main">
                                    <div><strong>${dateRange}</strong> · ${r.days} day${r.days === 1 ? '' : 's'} · ${typeLabel}</div>
                                    ${r.reason ? `<div class="att-muted">${escapeAttHtml(r.reason)}</div>` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
            </div>
        `;

    // Bereavement list
    const bereavementHtml = stats.bereavementApproved.length === 0
        ? ''
        : `
            <div class="att-section">
                <h4>🕊️ Bereavement Leave (${stats.bereavementApproved.length})</h4>
                ${stats.bereavementApproved
                    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
                    .map(r => {
                        const dateRange = r.startDate === r.endDate ? formatAttDate(r.startDate) : `${formatAttDate(r.startDate)} → ${formatAttDate(r.endDate)}`;
                        return `
                            <div class="att-event-row">
                                <div class="att-event-main">
                                    <div><strong>${dateRange}</strong> · ${r.days} day${r.days === 1 ? '' : 's'}</div>
                                    ${r.reason ? `<div class="att-muted">${escapeAttHtml(r.reason)}</div>` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
            </div>
        `;

    // Full chronological record
    const fullRecord = stats.approvedRequests.length === 0
        ? '<p style="color:#6c757d; margin: 0;">No approved requests in this period.</p>'
        : stats.approvedRequests
            .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
            .map(r => {
                const dateRange = r.startDate === r.endDate ? formatAttDate(r.startDate) : `${formatAttDate(r.startDate)} → ${formatAttDate(r.endDate)}`;
                const typeIcon = r.requestType === 'sick' ? '🏥' : r.requestType === 'bereavement' ? '🕊️' : '🏖️';
                const typeLabel = r.requestType === 'sick' ? 'Sick' : r.requestType === 'bereavement' ? 'Bereavement' : 'Holiday';
                const notice = getDaysNotice(r);
                const showNotice = r.requestType !== 'sick' && notice !== null && notice >= 0;
                return `
                    <div class="att-event-row">
                        <div class="att-event-main">
                            <div>${typeIcon} <strong>${dateRange}</strong> · ${r.days} day${r.days === 1 ? '' : 's'} · ${typeLabel}</div>
                            ${r.reason ? `<div class="att-muted">${escapeAttHtml(r.reason)}</div>` : ''}
                        </div>
                        <div class="att-event-meta">
                            ${showNotice ? `<div class="att-muted att-small">${notice}d notice</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

    return `
        <div class="att-detail-actions">
            <button onclick="backToAttendanceList()" style="background: #6c757d;">← Back to list</button>
            <button onclick="exportAttendanceReview(${employeeId})">📄 Export for Meeting</button>
            <button onclick="printAttendanceReview(${employeeId})" style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);">🖨️ Print</button>
        </div>

        <div class="att-detail-header">
            <h2 style="margin: 0;">${escapeAttHtml(employee.name)}</h2>
            <p style="margin: 4px 0 0 0; color: #6c757d;">Attendance Review · ${year}</p>
        </div>

        ${concernsBanner}

        <div class="att-tile-grid">
            <div class="att-tile">
                <div class="att-tile-label">Total days off</div>
                <div class="att-tile-value">${stats.totalDaysOff}</div>
                <div class="att-tile-sub">across ${stats.approvedCount} request${stats.approvedCount === 1 ? '' : 's'}</div>
            </div>
            <div class="att-tile tile-blue">
                <div class="att-tile-label">Holiday</div>
                <div class="att-tile-value">${stats.holidayDays}</div>
                <div class="att-tile-sub">of ${employee.totalAllowance} allowance</div>
            </div>
            <div class="att-tile tile-red">
                <div class="att-tile-label">Sick days</div>
                <div class="att-tile-value">${stats.sickDays}</div>
                <div class="att-tile-sub">${stats.sickOccurrences} occurrence${stats.sickOccurrences === 1 ? '' : 's'}</div>
            </div>
            <div class="att-tile tile-purple">
                <div class="att-tile-label">Bereavement</div>
                <div class="att-tile-value">${stats.bereavementDays}</div>
                <div class="att-tile-sub">${stats.bereavementApproved.length} occurrence${stats.bereavementApproved.length === 1 ? '' : 's'}</div>
            </div>
            <div class="att-tile tile-amber">
                <div class="att-tile-label">Short notice</div>
                <div class="att-tile-value">${stats.shortNoticeCount}</div>
                <div class="att-tile-sub">&lt; 7 days notice</div>
            </div>
            <div class="att-tile tile-grey">
                <div class="att-tile-label">Cancelled</div>
                <div class="att-tile-value">${stats.cancelledCount}</div>
                <div class="att-tile-sub">${stats.rejectedCount} rejected · ${stats.pendingCount} pending</div>
            </div>
        </div>

        <div class="att-section">
            <h4>📅 Holiday Notice Pattern</h4>
            <p style="color:#6c757d; margin: 0 0 12px 0;">
                ${stats.avgNoticeDays !== null
                    ? `Average notice given: <strong>${stats.avgNoticeDays} days</strong> across ${stats.holidayApproved.length} holiday request${stats.holidayApproved.length === 1 ? '' : 's'}.`
                    : 'No approved holiday requests in this period.'}
                ${stats.shortNoticeCount > 0 ? ` <strong>${stats.shortNoticeCount}</strong> request${stats.shortNoticeCount === 1 ? '' : 's'} below 7 days notice.` : ''}
            </p>
            ${shortNoticeHtml}
        </div>

        ${stats.sickOccurrences > 0 ? `
        <div class="att-section">
            <h4>🏥 Sick Leave Pattern</h4>
            <p style="color:#6c757d; margin: 0 0 12px 0;">
                <strong>${stats.sickOccurrences}</strong> sick leave occurrence${stats.sickOccurrences === 1 ? '' : 's'} totalling <strong>${stats.sickDays}</strong> day${stats.sickDays === 1 ? '' : 's'}.
                ${stats.mondayFridaySickPercent > 0 ? ` <strong>${stats.mondayFridaySickPercent}%</strong> fell on a Monday or Friday.` : ''}
            </p>
            <div class="sick-day-chart">${sickDayChart}</div>
            <h4 style="margin-top: 20px;">All Sick Leave Records</h4>
            ${sickEventsHtml}
        </div>
        ` : `
        <div class="att-section">
            <h4>🏥 Sick Leave</h4>
            <p style="color:#6c757d; margin: 0;">No sick leave recorded in ${year}.</p>
        </div>
        `}

        ${bereavementHtml}

        ${cancelledHtml}

        <div class="att-section">
            <h4>📋 Full Chronological Record</h4>
            ${fullRecord}
        </div>
    `;
}

function buildConcernsList(stats) {
    const concerns = [];
    if (stats.shortNoticeCount >= 3) {
        concerns.push(`<strong>${stats.shortNoticeCount}</strong> short-notice holiday requests (under 7 days notice).`);
    }
    if (stats.sameDayCount >= 1) {
        concerns.push(`<strong>${stats.sameDayCount}</strong> same-day holiday request${stats.sameDayCount === 1 ? '' : 's'} — submitted on the day of the booked leave.`);
    }
    if (stats.mondayFridaySickPercent >= 60 && stats.sickOccurrences >= 2) {
        concerns.push(`<strong>${stats.mondayFridaySickPercent}%</strong> of sick days fall on a Monday or Friday — pattern worth discussing.`);
    }
    if (stats.sickDays >= 7) {
        concerns.push(`Sick days total <strong>${stats.sickDays}</strong> across ${stats.sickOccurrences} occurrence${stats.sickOccurrences === 1 ? '' : 's'} — review wellbeing and any underlying causes.`);
    }
    if (stats.cancelledCount >= 3) {
        concerns.push(`<strong>${stats.cancelledCount}</strong> cancellations — may indicate planning issues or last-minute changes.`);
    }
    if (stats.avgNoticeDays !== null && stats.avgNoticeDays < 14 && stats.holidayApproved.length >= 3) {
        concerns.push(`Average holiday notice is only <strong>${stats.avgNoticeDays} days</strong> — encourage longer-term planning.`);
    }
    return concerns;
}

function formatAttDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escapeAttHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==================== ATTENDANCE EXPORT / PRINT ====================

function exportAttendanceReview(employeeId) {
    const stats = getAttendanceStats(employeeId, attendanceReviewYear);
    const html = generateStandaloneAttendanceHTML(stats);
    const filename = `${stats.employee.name.replace(/\s+/g, '_')}_Attendance_Review_${attendanceReviewYear}.html`;
    downloadHTML(html, filename);
}

function printAttendanceReview(employeeId) {
    const stats = getAttendanceStats(employeeId, attendanceReviewYear);
    const html = generateStandaloneAttendanceHTML(stats);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        toast.error('Pop-up blocked. Please allow pop-ups to print this report.', { title: 'Print blocked', duration: 7000 });
        return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => {
        printWindow.focus();
        printWindow.print();
    }, 400);
}

function generateStandaloneAttendanceHTML(stats) {
    const employee = stats.employee;
    const today = new Date().toLocaleDateString('en-GB');
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const concerns = buildConcernsList(stats);

    const rowHtml = (r) => {
        const dateRange = r.startDate === r.endDate ? formatAttDate(r.startDate) : `${formatAttDate(r.startDate)} → ${formatAttDate(r.endDate)}`;
        const typeLabel = r.requestType === 'sick' ? 'Sick' : r.requestType === 'bereavement' ? 'Bereavement' : 'Holiday';
        const dow = new Date(r.startDate).getDay();
        const dayLabel = dayNames[dow];
        const notice = getDaysNotice(r);
        const noticeStr = (r.requestType !== 'sick' && notice !== null && notice >= 0) ? `${notice}d` : '—';
        return `
            <tr>
                <td>${dateRange}</td>
                <td>${dayLabel}</td>
                <td>${typeLabel}</td>
                <td style="text-align:center;">${r.days}</td>
                <td style="text-align:center;">${noticeStr}</td>
                <td>${escapeAttHtml(r.reason || '')}</td>
            </tr>
        `;
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeAttHtml(employee.name)} — Attendance Review ${stats.year}</title>
<style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 30px; color: #24292f; line-height: 1.5; }
    h1 { margin: 0 0 4px 0; font-size: 28px; }
    h2 { font-size: 18px; margin: 30px 0 12px 0; color: #258bca; border-bottom: 2px solid #e9ecef; padding-bottom: 6px; }
    h3 { font-size: 15px; margin: 20px 0 10px 0; }
    .meta { color: #6c757d; font-size: 14px; margin-bottom: 20px; }
    .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }
    .tile { border: 1px solid #d0d7de; border-radius: 8px; padding: 14px; }
    .tile-lbl { font-size: 12px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.5px; }
    .tile-val { font-size: 28px; font-weight: 700; margin: 4px 0; }
    .tile-sub { font-size: 12px; color: #6c757d; }
    .concerns { background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 14px 18px; margin: 20px 0; }
    .concerns h3 { margin: 0 0 8px 0; color: #856404; }
    .concerns ul { margin: 0; padding-left: 20px; }
    .concerns li { margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 14px; }
    th { text-align: left; background: #f6f8fa; padding: 8px 10px; border-bottom: 2px solid #d0d7de; font-weight: 600; }
    td { padding: 8px 10px; border-bottom: 1px solid #e9ecef; vertical-align: top; }
    tr:nth-child(even) td { background: #fafbfc; }
    .empty { color: #6c757d; font-style: italic; padding: 8px 0; }
    .pattern-row { display: flex; align-items: center; gap: 10px; margin: 4px 0; font-size: 14px; }
    .pattern-label { width: 50px; color: #6c757d; }
    .pattern-track { flex: 1; height: 18px; background: #f6f8fa; border-radius: 4px; overflow: hidden; }
    .pattern-fill { height: 100%; background: #dc3545; }
    .pattern-fill.hot { background: linear-gradient(90deg, #dc3545, #fd7e14); }
    .pattern-count { width: 30px; text-align: right; font-weight: 600; }
    .signature-row { margin-top: 50px; display: flex; justify-content: space-between; gap: 40px; page-break-inside: avoid; }
    .sig-block { flex: 1; }
    .sig-line { border-top: 1px solid #24292f; margin-top: 50px; padding-top: 6px; font-size: 12px; color: #6c757d; }
    @media print {
        body { padding: 15px; max-width: 100%; }
        h1 { font-size: 22px; }
        h2 { font-size: 15px; }
        .tile-val { font-size: 22px; }
        .no-print { display: none; }
    }
</style>
</head>
<body>
    <h1>Attendance Review</h1>
    <div class="meta">
        <strong>${escapeAttHtml(employee.name)}</strong> · Year: ${stats.year} · Generated: ${today}
    </div>

    <div class="tiles">
        <div class="tile">
            <div class="tile-lbl">Total Days Off</div>
            <div class="tile-val">${stats.totalDaysOff}</div>
            <div class="tile-sub">across ${stats.approvedCount} request${stats.approvedCount === 1 ? '' : 's'}</div>
        </div>
        <div class="tile">
            <div class="tile-lbl">Holiday</div>
            <div class="tile-val">${stats.holidayDays}</div>
            <div class="tile-sub">of ${employee.totalAllowance} allowance</div>
        </div>
        <div class="tile">
            <div class="tile-lbl">Sick</div>
            <div class="tile-val">${stats.sickDays}</div>
            <div class="tile-sub">${stats.sickOccurrences} occurrence${stats.sickOccurrences === 1 ? '' : 's'}</div>
        </div>
        <div class="tile">
            <div class="tile-lbl">Bereavement</div>
            <div class="tile-val">${stats.bereavementDays}</div>
            <div class="tile-sub">${stats.bereavementApproved.length} occurrence${stats.bereavementApproved.length === 1 ? '' : 's'}</div>
        </div>
        <div class="tile">
            <div class="tile-lbl">Short Notice</div>
            <div class="tile-val">${stats.shortNoticeCount}</div>
            <div class="tile-sub">&lt; 7 days notice</div>
        </div>
        <div class="tile">
            <div class="tile-lbl">Cancelled</div>
            <div class="tile-val">${stats.cancelledCount}</div>
            <div class="tile-sub">${stats.rejectedCount} rejected · ${stats.pendingCount} pending</div>
        </div>
    </div>

    ${concerns.length > 0 ? `
    <div class="concerns">
        <h3>Discussion Points</h3>
        <ul>${concerns.map(c => `<li>${c}</li>`).join('')}</ul>
    </div>` : ''}

    <h2>Holiday Notice Summary</h2>
    <p style="margin: 0 0 10px 0;">
        ${stats.avgNoticeDays !== null
            ? `Average notice given: <strong>${stats.avgNoticeDays} days</strong> across ${stats.holidayApproved.length} request${stats.holidayApproved.length === 1 ? '' : 's'}.`
            : 'No approved holiday requests in this period.'}
        ${stats.shortNoticeCount > 0 ? ` <strong>${stats.shortNoticeCount}</strong> below 7 days. ` : ''}
        ${stats.sameDayCount > 0 ? `<strong>${stats.sameDayCount}</strong> same-day request${stats.sameDayCount === 1 ? '' : 's'}.` : ''}
    </p>
    ${stats.shortNoticeRequests.length > 0 ? `
    <table>
        <thead>
            <tr><th>Dates</th><th>Day</th><th>Days</th><th>Notice</th><th>Submitted</th><th>Reason</th></tr>
        </thead>
        <tbody>
            ${stats.shortNoticeRequests.sort((a, b) => new Date(b.startDate) - new Date(a.startDate)).map(r => {
                const dateRange = r.startDate === r.endDate ? formatAttDate(r.startDate) : `${formatAttDate(r.startDate)} → ${formatAttDate(r.endDate)}`;
                const dow = new Date(r.startDate).getDay();
                const notice = getDaysNotice(r);
                return `<tr>
                    <td>${dateRange}</td>
                    <td>${dayNames[dow]}</td>
                    <td style="text-align:center;">${r.days}</td>
                    <td style="text-align:center;"><strong>${notice === 0 ? 'Same day' : notice + 'd'}</strong></td>
                    <td>${formatAttDate(r.submittedDate)}</td>
                    <td>${escapeAttHtml(r.reason || '')}</td>
                </tr>`;
            }).join('')}
        </tbody>
    </table>` : '<p class="empty">No short-notice holiday requests in this period.</p>'}

    <h2>Sick Leave</h2>
    ${stats.sickOccurrences > 0 ? `
    <p style="margin: 0 0 10px 0;">
        <strong>${stats.sickOccurrences}</strong> occurrence${stats.sickOccurrences === 1 ? '' : 's'} totalling <strong>${stats.sickDays}</strong> day${stats.sickDays === 1 ? '' : 's'}.
        ${stats.mondayFridaySickPercent > 0 ? `<strong>${stats.mondayFridaySickPercent}%</strong> on Monday/Friday.` : ''}
    </p>
    <h3>Day-of-Week Pattern</h3>
    ${[1,2,3,4,5].map(idx => {
        const count = stats.sickByDayOfWeek[idx];
        const max = Math.max(...stats.sickByDayOfWeek, 1);
        const pct = (count / max) * 100;
        const isHot = (idx === 1 || idx === 5) && count > 0;
        return `<div class="pattern-row">
            <div class="pattern-label">${dayNames[idx].substring(0,3)}</div>
            <div class="pattern-track"><div class="pattern-fill ${isHot ? 'hot' : ''}" style="width:${Math.max(pct, 2)}%"></div></div>
            <div class="pattern-count">${count}</div>
        </div>`;
    }).join('')}
    <h3>All Sick Leave Records</h3>
    <table>
        <thead><tr><th>Dates</th><th>Day</th><th>Days</th><th>Recorded By</th><th>Reason</th></tr></thead>
        <tbody>
            ${stats.sickApproved.sort((a, b) => new Date(b.startDate) - new Date(a.startDate)).map(r => {
                const dateRange = r.startDate === r.endDate ? formatAttDate(r.startDate) : `${formatAttDate(r.startDate)} → ${formatAttDate(r.endDate)}`;
                const dow = new Date(r.startDate).getDay();
                return `<tr>
                    <td>${dateRange}</td>
                    <td>${dayNames[dow]}</td>
                    <td style="text-align:center;">${r.days}</td>
                    <td>${escapeAttHtml(r.approvedBy || '')}</td>
                    <td>${escapeAttHtml(r.reason || '')}</td>
                </tr>`;
            }).join('')}
        </tbody>
    </table>` : '<p class="empty">No sick leave recorded in this period.</p>'}

    ${stats.bereavementApproved.length > 0 ? `
    <h2>Bereavement Leave</h2>
    <table>
        <thead><tr><th>Dates</th><th>Days</th><th>Reason</th></tr></thead>
        <tbody>
            ${stats.bereavementApproved.sort((a, b) => new Date(b.startDate) - new Date(a.startDate)).map(r => {
                const dateRange = r.startDate === r.endDate ? formatAttDate(r.startDate) : `${formatAttDate(r.startDate)} → ${formatAttDate(r.endDate)}`;
                return `<tr>
                    <td>${dateRange}</td>
                    <td style="text-align:center;">${r.days}</td>
                    <td>${escapeAttHtml(r.reason || '')}</td>
                </tr>`;
            }).join('')}
        </tbody>
    </table>` : ''}

    ${stats.cancelledRequests.length > 0 ? `
    <h2>Cancelled Requests</h2>
    <table>
        <thead><tr><th>Dates</th><th>Type</th><th>Days</th><th>Reason</th></tr></thead>
        <tbody>
            ${stats.cancelledRequests.sort((a, b) => new Date(b.startDate) - new Date(a.startDate)).map(r => {
                const dateRange = r.startDate === r.endDate ? formatAttDate(r.startDate) : `${formatAttDate(r.startDate)} → ${formatAttDate(r.endDate)}`;
                const typeLabel = r.requestType === 'sick' ? 'Sick' : r.requestType === 'bereavement' ? 'Bereavement' : 'Holiday';
                return `<tr>
                    <td>${dateRange}</td>
                    <td>${typeLabel}</td>
                    <td style="text-align:center;">${r.days}</td>
                    <td>${escapeAttHtml(r.reason || '')}</td>
                </tr>`;
            }).join('')}
        </tbody>
    </table>` : ''}

    <h2>Full Chronological Record</h2>
    ${stats.approvedRequests.length > 0 ? `
    <table>
        <thead><tr><th>Dates</th><th>Day</th><th>Type</th><th>Days</th><th>Notice</th><th>Reason</th></tr></thead>
        <tbody>
            ${stats.approvedRequests.sort((a, b) => new Date(a.startDate) - new Date(b.startDate)).map(rowHtml).join('')}
        </tbody>
    </table>` : '<p class="empty">No approved requests in this period.</p>'}

    <div class="signature-row">
        <div class="sig-block">
            <div class="sig-line">Employee signature & date</div>
        </div>
        <div class="sig-block">
            <div class="sig-line">Manager signature & date</div>
        </div>
    </div>
</body>
</html>`;
}
