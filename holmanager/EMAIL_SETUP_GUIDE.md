# Email Notification Setup Guide

Your Holiday Management System now includes comprehensive email notifications! Here's what gets notified:

## 📧 Email Notifications Include:

1. **New Request Submitted** → Notifies all admins
2. **Request Approved** → Notifies the employee
3. **Request Declined** → Notifies the employee
4. **Request Cancelled** → Notifies the employee

---

## Setup Instructions

### Option 1: EmailJS (Recommended - Free Tier Available)

EmailJS is a free email service that's perfect for client-side applications like this one.

### Step 1: Create an EmailJS Account

1. Go to [https://www.emailjs.com/](https://www.emailjs.com/)
2. Click "Sign Up" and create a free account
3. Verify your email address

### Step 2: Add an Email Service

1. In your EmailJS dashboard, go to "Email Services"
2. Click "Add New Service"
3. Choose your email provider (Gmail, Outlook, etc.)
4. Follow the prompts to connect your email account
5. Note down your **Service ID** (e.g., "service_abc123")

### Step 3: Create TWO Email Templates

You need to create two separate templates - one for employees and one for admins.

#### Template 1: Employee Notification (Approve/Decline/Cancel)

1. Go to "Email Templates" in your EmailJS dashboard
2. Click "Create New Template"
3. Name it "Employee Holiday Notification"

**Subject:**
```
Holiday Request {{status}} - {{employee_name}}
```

**Content:**
```html
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: {{status_color}}; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
        .detail { margin: 10px 0; }
        .label { font-weight: bold; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>Your {{request_type}} Request has been {{status}}</h2>
        </div>
        <div class="content">
            <p>Hello {{employee_name}},</p>
            
            <p>Your request has been <strong>{{status}}</strong>.</p>
            
            <div class="detail">
                <span class="label">Request Type:</span> {{request_type}}{{half_day_period}}
            </div>
            
            <div class="detail">
                <span class="label">Start Date:</span> {{start_date}}
            </div>
            
            <div class="detail">
                <span class="label">End Date:</span> {{end_date}}
            </div>
            
            <div class="detail">
                <span class="label">Number of Days:</span> {{days}}
            </div>
            
            <p>If you have any questions, please contact HR.</p>
            
            <p>Best regards,<br>HR Team</p>
        </div>
    </div>
</body>
</html>
```

4. Click "Save" and note down this **Template ID** (e.g., "template_employee_xyz")

#### Template 2: Admin Notification (New Submissions)

1. Click "Create New Template" again
2. Name it "Admin New Request Notification"

**Subject:**
```
NEW: {{request_type}} Request from {{employee_name}} - {{year}}
```

**Content:**
```html
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
        .detail { margin: 10px 0; padding: 10px; background: white; border-left: 3px solid #667eea; }
        .label { font-weight: bold; color: #666; display: inline-block; width: 150px; }
        .action-required { background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 15px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>🔔 New {{request_type}} Request</h2>
        </div>
        <div class="content">
            <div class="action-required">
                <strong>⚠️ Action Required:</strong> Please review and approve/decline this request.
            </div>
            
            <div class="detail">
                <span class="label">Employee:</span> <strong>{{employee_name}}</strong>
            </div>
            
            <div class="detail">
                <span class="label">Request Type:</span> {{request_type}}{{half_day_period}}
            </div>
            
            <div class="detail">
                <span class="label">Start Date:</span> {{start_date}}
            </div>
            
            <div class="detail">
                <span class="label">End Date:</span> {{end_date}}
            </div>
            
            <div class="detail">
                <span class="label">Number of Days:</span> {{days}}
            </div>
            
            <div class="detail">
                <span class="label">Block Booking:</span> {{is_block_booking}}
            </div>
            
            <div class="detail">
                <span class="label">Reason:</span> {{reason}}
            </div>
            
            <div class="detail">
                <span class="label">Year:</span> {{year}}
            </div>
            
            <p style="margin-top: 20px;">Please log in to the Holiday Management System to approve or decline this request.</p>
            
            <p>Best regards,<br>Holiday Management System</p>
        </div>
    </div>
</body>
</html>
```

3. Click "Save" and note down this **Template ID** (e.g., "template_admin_abc")

### Step 4: Get Your Public Key

1. Go to "Account" → "General" in your EmailJS dashboard
2. Find and copy your **Public Key** (also called User ID)

### Step 5: Update Your Configuration

Open the `script.js` file and find the `EMAIL_CONFIG` section near the top (around line 20):

```javascript
const EMAIL_CONFIG = {
    serviceId: 'YOUR_EMAILJS_SERVICE_ID',
    publicKey: 'YOUR_EMAILJS_PUBLIC_KEY',
    
    templates: {
        employeeNotification: 'YOUR_EMPLOYEE_TEMPLATE_ID',
        adminNotification: 'YOUR_ADMIN_TEMPLATE_ID'
    },
    
    adminEmails: 'admin1@company.com, admin2@company.com'
};
```

Replace with your actual values:

```javascript
const EMAIL_CONFIG = {
    serviceId: 'service_abc123',           // Your Service ID from Step 2
    publicKey: 'abcdefGHIJKLMNOP',         // Your Public Key from Step 4
    
    templates: {
        employeeNotification: 'template_employee_xyz',  // Template 1 ID
        adminNotification: 'template_admin_abc'         // Template 2 ID
    },
    
    // Update with your actual admin email addresses (comma-separated)
    adminEmails: 'ske@kerrandsmith.co.uk, sar@kerrandsmith.co.uk, ake@kerrandsmith.co.uk'
};
```

**Note:** The admin emails are already pre-configured with your company emails, but you can modify them if needed.

### Step 6: Test It!

1. Upload all three files (index.html, script.js, style.css) to your web server
2. Test each notification type:
   - **Submit a new request** → Admins should receive an email
   - **Approve a request** → Employee should receive an approval email
   - **Decline a request** → Employee should receive a decline email
   - **Cancel a request** → Employee should receive a cancellation email

---

## How It Works

### When an Employee Submits a Request:
1. The request is saved to GitHub
2. An email is sent to ALL admin email addresses
3. The email includes all request details and a reminder to log in

### When an Admin Approves/Declines:
1. The request status is updated
2. Days are deducted (if applicable)
3. An email is sent to the employee with the decision
4. Color-coded for easy identification (green = approved, red = declined)

### When an Employee Cancels:
1. Days are returned to allowance (if applicable)
2. Request status is updated to cancelled
3. An email confirmation is sent to the employee
4. Yellow color coding for cancellations

### Error Handling:
- If email sending fails, it won't break the app
- Errors are logged to the browser console
- The approve/decline/submit/cancel action still completes successfully

---

## Email Template Variables

### Employee Notification Template Variables:
- `{{employee_name}}` - Name of the employee
- `{{request_type}}` - Type of request (Holiday, Sick Leave, Bereavement Leave)
- `{{start_date}}` - Start date (formatted: "30 October 2025")
- `{{end_date}}` - End date (formatted: "30 October 2025")
- `{{days}}` - Number of days requested
- `{{status}}` - APPROVED, DECLINED, or CANCELLED
- `{{half_day_period}}` - Shows "(AM)" or "(PM)" if half-day
- `{{status_color}}` - Color code: #28a745 (green), #dc3545 (red), #ffc107 (yellow)

### Admin Notification Template Variables:
- `{{to_email}}` - Admin email addresses (automatically populated)
- `{{employee_name}}` - Name of the employee who submitted
- `{{request_type}}` - Type of request
- `{{start_date}}` - Start date (formatted)
- `{{end_date}}` - End date (formatted)
- `{{days}}` - Number of days requested
- `{{reason}}` - Reason provided by employee
- `{{half_day_period}}` - Shows "(AM)" or "(PM)" if half-day
- `{{is_block_booking}}` - "Yes" or "No"
- `{{year}}` - Year of the request

---

## Customization

### Want to customize the emails?

You can customize both email templates in your EmailJS dashboard at any time. Changes take effect immediately without needing to update your code!

### Want to add more admins?

Just update the `adminEmails` in the EMAIL_CONFIG:

```javascript
adminEmails: 'admin1@company.com, admin2@company.com, admin3@company.com'
```

### Want different email providers?

EmailJS supports many providers:
- Gmail
- Outlook
- Yahoo
- Custom SMTP servers
- And many more!

---

## Troubleshooting

### Emails not sending?

1. **Check browser console** (F12 → Console tab) for error messages
2. **Verify credentials** - Make sure Service ID, Template IDs, and Public Key are correct
3. **Check email service** - Ensure your email service is active in EmailJS
4. **Verify templates** - Both templates must exist and match the IDs in config
5. **Check usage limits** - Free tier has 200 emails/month

### Want to test without setting up emails?

The system works perfectly without email configuration! It will just log messages to the console instead. All functionality (submit, approve, decline, cancel) works normally.

### Testing tip:

Before going live, send a few test requests to yourself to verify:
- Email formatting looks good
- All variables populate correctly
- Links work (if you add any)
- Spam filters aren't catching the emails

---

## EmailJS Free Tier Limits

- **200 emails per month** (perfect for most small teams)
- **2 email services**
- Unlimited templates
- Basic analytics

If you need more, paid plans start at $7/month for 1,000 emails.

---

## Alternative Options

If you prefer not to use EmailJS, you can modify the `sendEmailNotification` function to use:

- **Formspree** - Form submission service
- **SendGrid** - Professional email API
- **Mailgun** - Transactional email service
- **Custom API** - Your own backend email service
- **Zapier/Make** - Automation platforms

Just replace the `emailjs.send()` call with your preferred service's API.

---

## Need Help?

If you run into any issues setting this up, check:
1. EmailJS documentation: https://www.emailjs.com/docs/
2. Browser console for error messages
3. EmailJS dashboard for delivery logs

The system is now fully configured for automated email notifications at every step of the holiday request process!
