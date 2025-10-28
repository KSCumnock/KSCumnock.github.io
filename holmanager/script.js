function filterEmployeeCards() {
    const searchTerm = document.getElementById('employee-search').value.toLowerCase();
    const cards = document.querySelectorAll('.employee-card-selector');

    cards.forEach(card => {
        const name = card.querySelector('.employee-card-name').textContent.toLowerCase();
        card.style.display = name.includes(searchTerm) ? 'block' : 'none';
    });
}

// Configuration - GitHub Integration
const GITHUB_CONFIG = {
    owner: 'KSCumnock',
    repo: 'Holidays',
    branch: 'main',
    token: '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',
};

const GITHUB_API_BASE = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/`;

// Data storage with GitHub SHA tracking
let employees = [];
let holidayRequests = [];
let employeesSha = null;
let holidayRequestsSha = null;
let currentEmployee = null;
let nextRequestId = 1;
let nextEmployeeId = 1;
let currentDate = new Date();
let currentPopover = null;
let currentYear = 2025; // Add current year tracking

// Block booking variables
let isBlockBooking = false;
let selectedDates = [];
let blockCalendarDate = new Date();

// Dynamic file names based on selected year
function getEmployeesFileName() {
    return `employees${currentYear}.json`;
}

function getHolidayRequestsFileName() {
    return `holiday-requests${currentYear}.json`;
}

// GitHub API Functions
async function getFileFromGitHub(filename) {
    try {
        const response = await fetch(GITHUB_API_BASE + filename, {
            headers: {
                'Authorization': `token ${GITHUB_CONFIG.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!response.ok) {
            if (response.status === 404) {
                // File doesn't exist, create empty structure
                return {
                    content: [],
                    sha: null
                };
            }
            throw new Error(`Failed to fetch ${filename}: ${response.statusText}`);
        }
        
        const data = await response.json();
        return {
            content: JSON.parse(atob(data.content)),
            sha: data.sha
        };
    } catch (error) {
        console.error(`Error fetching ${filename}:`, error);
        // Return empty structure if file doesn't exist
        if (error.message.includes('404')) {
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
        const body = {
            message: commitMessage,
            content: btoa(JSON.stringify(content, null, 2)),
            branch: GITHUB_CONFIG.branch
        };
        
        if (sha) {
            body.sha = sha;
        }
        
        const response = await fetch(GITHUB_API_BASE + filename, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_CONFIG.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            throw new Error(`Failed to save ${filename}: ${response.statusText}`);
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
        alert('Failed to save employee data to GitHub. Please try again.');
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
        alert('Failed to save holiday request data to GitHub. Please try again.');
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
    document.getElementById('current-year-display').textContent = `Current: ${currentYear}`;
    
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
        
        // Set initial year
        currentYear = parseInt(document.getElementById('year-select').value);
        document.getElementById('current-year-display').textContent = `Current: ${currentYear}`;
        
        await loadEmployees();
        await loadHolidayRequests();
        populateEmployeeCards();
        renderCalendar();
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

// Tab switching
function showTab(tabName) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.content').forEach(content => content.classList.add('hidden'));
    
    if (tabName === 'admin') {
        document.getElementById('pin-modal').classList.remove('hidden');
        document.getElementById('pin-modal').style.display = 'flex';
    } else if (tabName === 'calendar') {
        document.getElementById('calendar-tab').classList.remove('hidden');
        document.querySelectorAll('.tab')[1].classList.add('active');
        renderCalendar();
    } else if (tabName === 'analytics') {
        document.getElementById('analytics-tab').classList.remove('hidden');
        document.querySelectorAll('.tab')[2].classList.add('active');
        refreshAnalytics();
    } else {
        document.getElementById('employee-tab').classList.remove('hidden');
        document.querySelectorAll('.tab')[0].classList.add('active');
    }
    
    // Close any open popovers
    closePopover();
}

// PIN modal functions
async function checkPin() {
    const pin = document.getElementById('pin-input').value;
    if (pin === '4224') {
        closePinModal();
        document.getElementById('admin-tab').classList.remove('hidden');
        document.querySelectorAll('.tab')[2].classList.add('active');
        await loadAdminData();
    } else {
        alert('Incorrect PIN. Please try again.');
        document.getElementById('pin-input').value = '';
    }
}

function closePinModal() {
    const pinModal = document.getElementById('pin-modal');
    pinModal.classList.add('hidden');
    pinModal.style.display = 'none';
    document.getElementById('pin-input').value = '';
}

// Employee functions
function populateEmployeeCards() {
    const container = document.getElementById('employee-cards');
    
    if (employees.length === 0) {
        container.innerHTML = '<p>No employees found.</p>';
        return;
    }
    
    container.innerHTML = employees.map(employee => {
        const remainingDays = employee.totalAllowance - employee.usedDays;
        const employeeRequests = holidayRequests.filter(req => req.employeeId === employee.id);
        const approvedRequests = employeeRequests.filter(req => req.status === 'approved');
        const pendingRequests = employeeRequests.filter(req => req.status === 'pending');
        
        // Find next upcoming holiday/leave
        const today = new Date().toISOString().split('T')[0];
        const upcomingLeave = approvedRequests.filter(req => req.startDate >= today)
            .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
        
        let nextLeaveText = 'No upcoming leave';
        let nextLeaveClass = 'none';
        
        if (upcomingLeave.length > 0) {
            const nextLeave = upcomingLeave[0];
            const daysUntil = Math.ceil((new Date(nextLeave.startDate) - new Date(today)) / (1000 * 60 * 60 * 24));
            const leaveType = nextLeave.requestType || 'holiday';
            const typeText = leaveType === 'holiday' ? 'Holiday' : 
                           leaveType === 'sick' ? 'Sick leave' : 'Bereavement';
            
            if (daysUntil === 0) {
                nextLeaveText = `${typeText} starts today!`;
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
                        <strong>${remainingDays}</strong> days left
                    </div>
                    <div class="employee-stat">
                        <strong>${pendingRequests.length}</strong> pending
                    </div>
                    <div class="employee-stat">
                        <strong>${employee.totalAllowance}</strong> total allowance
                    </div>
                    <div class="employee-stat">
                        <strong>${employeeRequests.length}</strong> total requests
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
            
            // Check if date is selected
            if (selectedDates.includes(dateStr)) {
                dayElement.classList.add('selected');
            }
            
            // Add click handler for selectable dates
            dayElement.addEventListener('click', () => toggleDateSelection(dateStr));
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
            alert('Please select at least one date.');
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
            alert(`You don't have enough holiday days remaining. You need ${totalDaysNeeded} days but only have ${remainingDays} days left.`);
            return;
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
                status: 'pending',
                submittedDate: new Date().toISOString().split('T')[0],
                requestType: requestType,
                deductFromHoliday: shouldDeductDays,
                isBlockBooking: true,
                selectedDates: group.dates
            };
            
            newRequests.push(newRequest);
        }
        
        // Add all requests
        holidayRequests.push(...newRequests);
        await saveHolidayRequests();
        
        // Send email notification
        const typeText = requestType === 'holiday' ? 'Holiday' : 
                        requestType === 'sick' ? 'Sick Leave' : 'Bereavement Leave';
        const recipients = 'ske@kerrandsmith.co.uk; sar@kerrandsmith.co.uk; ake@kerrandsmith.co.uk; nde@kerrandsmith.co.uk; ksh@kerrandsmith.co.uk; dmc@kerrandsmith.co.uk; wsm@kerrandsmith.co.uk';
        const subject = encodeURIComponent(`${typeText} Block Booking Request [${currentEmployee.name}] - ${currentYear}`);
        const body = encodeURIComponent(`A ${typeText.toLowerCase()} block booking request for ${currentEmployee.name} has been submitted for ${currentYear} (${groups.length} separate bookings). Please log in to approve or decline the requests.`);
        
        window.location.href = `mailto:${recipients}?subject=${subject}&body=${body}`;
        
        alert(`${typeText} block booking submitted successfully! Created ${groups.length} separate request${groups.length !== 1 ? 's' : ''}.`);
        
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
            alert(`You don't have enough holiday days remaining. You have ${remainingDays} days left.`);
            return;
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
            status: 'pending',
            submittedDate: new Date().toISOString().split('T')[0],
            requestType: requestType,
            deductFromHoliday: shouldDeductDays
        };
        
        holidayRequests.push(newRequest);
        await saveHolidayRequests();
        
        // Send email notification
        const typeText = requestType === 'holiday' ? 'Holiday' : 
                        requestType === 'sick' ? 'Sick Leave' : 'Bereavement Leave';
        const recipients = 'ske@kerrandsmith.co.uk; sar@kerrandsmith.co.uk; ake@kerrandsmith.co.uk; nde@kerrandsmith.co.uk; ksh@kerrandsmith.co.uk; dmc@kerrandsmith.co.uk; wsm@kerrandsmith.co.uk';
        const subject = encodeURIComponent(`${typeText} Request [${currentEmployee.name}] - ${currentYear}`);
      let bodyText;

if (requestType === 'holiday') {
    bodyText = `A holiday request for ${currentEmployee.name} has been submitted for ${currentYear} from ${startDate} to ${endDate}. Please log in to approve or decline this holiday request.`;
} else if (requestType === 'sick') {
    bodyText = `${currentEmployee.name} has reported sick leave starting ${startDate}${endDate !== startDate ? ` to ${endDate}` : ''}. Please log in to record or update this sickness period.`;
} else if (requestType === 'bereavement') {
    bodyText = `${currentEmployee.name} has submitted a bereavement leave request for ${currentYear}. Please log in to review and confirm the details.`;
} else {
    bodyText = `A leave request for ${currentEmployee.name} has been submitted for ${currentYear}. Please log in to review it.`;
}

const body = encodeURIComponent(bodyText);

        
        window.location.href = `mailto:${recipients}?subject=${subject}&body=${body}`;
        
        alert(`${typeText} request submitted successfully!`);
        
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
}

function loadEmployeeRequests() {
    if (!currentEmployee) return;
    
    const container = document.getElementById('employee-requests');
    const requests = holidayRequests.filter(req => req.employeeId === currentEmployee.id);
    
    if (requests.length === 0) {
        container.innerHTML = '<p>No requests found.</p>';
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
        
        return `
            <div class="holiday-request ${request.status}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div style="flex: 1;">
                        <h4>${dateRange} (${dayText})</h4>
                        <p><strong>Type:</strong> ${typeText}${deductText}</p>
                        ${blockBookingDetails}
                        <p><strong>Reason:</strong> ${request.reason || 'Not specified'}</p>
                        <p><strong>Submitted:</strong> ${request.submittedDate}</p>
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
    if (!confirm('Are you sure you want to cancel this request?')) return;
    
    const request = holidayRequests.find(req => req.id === requestId);
    if (request) {
        // If the request was approved and it's a holiday or deducts from holiday allowance, return the days
        if (request.status === 'approved' && (request.requestType === 'holiday' || request.deductFromHoliday)) {
            const employee = employees.find(emp => emp.id === request.employeeId);
            if (employee) {
                employee.usedDays -= request.days;
                await saveEmployees();
            }
        }
        
        request.status = 'cancelled';
        request.cancelledDate = new Date().toISOString().split('T')[0];
        await saveHolidayRequests();
        
        // Refresh displays
        if (currentEmployee && currentEmployee.id === request.employeeId) {
            loadEmployeeRequests();
        }
        renderCalendar();
        
        alert('Request cancelled successfully!');
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
            
            // Add click handler for popover
            dayElement.addEventListener('click', (e) => {
                e.stopPropagation();
                showRequestPopover(e.currentTarget, dateStr, requestsOnDate);
            });
        }
        
        grid.appendChild(dayElement);
    }
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

function showRequestPopover(element, dateStr, requests) {
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
        if ((section === 'pending' && index === 0) ||
            (section === 'employees' && index === 1) ||
            (section === 'all-requests' && index === 2) ||
            (section === 'employee-view' && index === 3) ||
            (section === 'reports' && index === 4)) {
            btn.classList.add('active');
        }
    });
    
    currentAdminSection = section;
    
    // Load data for specific sections
    if (section === 'employee-view') {
        loadEmployeeQuickView();
    } else if (section === 'reports') {
        loadReportsSection();
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
        container.innerHTML = '<p>No employees found.</p>';
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
        content += '<p>No requests found for this employee.</p>';
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
        container.innerHTML = '<p>No pending requests.</p>';
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

async function approveRequest(requestId) {
    const request = holidayRequests.find(req => req.id === requestId);
    if (request) {
        request.status = 'approved';
        request.approvedDate = new Date().toISOString().split('T')[0];
        
        const employee = employees.find(emp => emp.id === request.employeeId);
        if (employee) {
            // Only deduct days if it's a holiday or explicitly marked to deduct
            if (request.requestType === 'holiday' || request.deductFromHoliday) {
                employee.usedDays += request.days;
                await saveEmployees();
            }
        }
        
        await saveHolidayRequests();
        loadAdminData();
        renderCalendar();
    }
}

async function rejectRequest(requestId) {
    const request = holidayRequests.find(req => req.id === requestId);
    if (request) {
        // If this was previously approved and deducted days, return them
        if (request.status === 'approved' && (request.requestType === 'holiday' || request.deductFromHoliday)) {
            const employee = employees.find(emp => emp.id === request.employeeId);
            if (employee) {
                employee.usedDays -= request.days;
                await saveEmployees();
            }
        }
        
        request.status = 'rejected';
        request.rejectedDate = new Date().toISOString().split('T')[0];
        await saveHolidayRequests();
        loadAdminData();
    }
}

async function addEmployee(event) {
    event.preventDefault();
    
    const name = document.getElementById('new-employee-name').value;
    const allowance = parseFloat(document.getElementById('employee-allowance').value);
    const includeSaturdayDeduction = document.getElementById('include-saturday-deduction').checked;
    
    if (!name || name.trim() === '') {
        alert('Please enter an employee name');
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
    if (confirm('Are you sure you want to remove this employee? This will also remove all their requests.')) {
        employees = employees.filter(emp => emp.id !== employeeId);
        holidayRequests = holidayRequests.filter(req => req.employeeId !== employeeId);
        
        await saveEmployees();
        await saveHolidayRequests();
        
        populateEmployeeCards();
        loadAdminData();
        renderCalendar();
        
        // Clear employee info if removed employee was selected
        if (currentEmployee && currentEmployee.id === employeeId) {
            currentEmployee = null;
            document.getElementById('employee-info').classList.add('hidden');
            // Remove selection from cards
            document.querySelectorAll('.employee-card-selector').forEach(card => {
                card.classList.remove('selected');
            });
        }
    }
}

function loadEmployeeList() {
    const container = document.getElementById('employee-list');
    
    if (employees.length === 0) {
        container.innerHTML = '<p>No employees found.</p>';
        return;
    }
    
    container.innerHTML = employees.map(employee => `
        <div class="employee-card">
            <div>
                <h5>${employee.name}</h5>
                <p style="font-size: 13px;">Total: ${employee.totalAllowance} | Used: ${employee.usedDays} | Remaining: ${employee.totalAllowance - employee.usedDays}</p>
            </div>
            <button class="btn-danger btn-small" onclick="removeEmployee(${employee.id})">Remove</button>
        </div>
    `).join('');
}

function loadAllRequests() {
    const container = document.getElementById('all-requests');
    
    if (holidayRequests.length === 0) {
        container.innerHTML = '<p>No requests found.</p>';
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
                    </div>
                    <div style="margin-left: 15px;">
                        <span class="status-badge status-${request.status}">${request.status}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

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
            remainingDays: employee.totalAllowance - employee.usedDays
        },
        upcomingRequests,
        pastRequests,
        allRequests: employeeRequests.sort((a, b) => new Date(b.submittedDate) - new Date(a.submittedDate))
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
            
            html += `
                <tr>
                    <td>${typeText}</td>
                    <td>${request.startDate}</td>
                    <td>${request.endDate}</td>
                    <td>${dayText}</td>
                    <td>${request.reason || 'Not specified'}</td>
                    <td>${request.isBlockBooking ? 'Yes' : 'No'}</td>
                    <td>${request.deductFromHoliday ? 'Yes' : 'No'}</td>
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
        alert('Please select an employee first.');
        return;
    }
    
    const reportData = generateEmployeeReportData(selectedEmployeeId);
    if (!reportData) {
        alert('Employee not found.');
        return;
    }
    
    const html = generateReportHTML(reportData);
    downloadHTML(html, `${reportData.employee.name}_Report_${currentYear}_${new Date().toISOString().split('T')[0]}.html`);
}

function exportAllEmployeesReport() {
    if (employees.length === 0) {
        alert('No employees found.');
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
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    holidayRequests.filter(req => {
        const reqYear = new Date(req.startDate).getFullYear();
        return reqYear === year && req.status === 'approved';
    }).forEach(req => {
        const month = new Date(req.startDate).getMonth();
        monthlyData[month] += req.days || 0;
    });
    
    const maxValue = Math.max(...monthlyData, 1);
    
    let html = '<div style="display: flex; align-items: flex-end; justify-content: space-between; height: 250px; gap: 10px;">';
    monthlyData.forEach((days, index) => {
        const height = (days / maxValue) * 100;
        html += `
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center;">
                <div style="width: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 4px 4px 0 0; height: ${height}%; min-height: ${days > 0 ? '20px' : '0'}; position: relative; display: flex; align-items: flex-start; justify-content: center; padding-top: 5px;">
                    ${days > 0 ? `<span style="color: white; font-size: 12px; font-weight: 600;">${days}</span>` : ''}
                </div>
                <div style="margin-top: 8px; font-size: 12px; color: #666; font-weight: 500;">${monthNames[index]}</div>
            </div>
        `;
    });
    html += '</div>';
    
    document.getElementById('monthly-chart').innerHTML = html;
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
});

// Handle Enter key in PIN input
document.getElementById('pin-input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        checkPin();
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