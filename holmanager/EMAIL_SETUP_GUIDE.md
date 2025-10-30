# Email Notification Setup Guide

Your Holiday Management System now includes email notifications for approved and declined requests! Here's how to set it up:

## Option 1: EmailJS (Recommended - Free Tier Available)

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

### Step 3: Create an Email Template

1. Go to "Email Templates" in your EmailJS dashboard
2. Click "Create New Template"
3. Use this template structure:

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
            
            <p>Your holiday request has been <strong>{{status}}</strong>.</p>
            
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

4. Click "Save" and note down your **Template ID** (e.g., "template_xyz789")

### Step 4: Get Your Public Key

1. Go to "Account" → "General" in your EmailJS dashboard
2. Find and copy your **Public Key** (also called User ID)

### Step 5: Update Your Configuration

Open the `script.js` file and find the `EMAIL_CONFIG` section near the top:

```javascript
const EMAIL_CONFIG = {
    serviceId: 'YOUR_EMAILJS_SERVICE_ID',  // Replace with your Service ID
    templateId: 'YOUR_EMAILJS_TEMPLATE_ID', // Replace with your Template ID
    publicKey: 'YOUR_EMAILJS_PUBLIC_KEY'    // Replace with your Public Key
};
```

Replace the placeholder values with your actual EmailJS credentials:

```javascript
const EMAIL_CONFIG = {
    serviceId: 'service_abc123',      // Your actual Service ID
    templateId: 'template_xyz789',     // Your actual Template ID
    publicKey: 'abcdefGHIJKLMNOP'      // Your actual Public Key
};
```

### Step 6: Test It!

1. Upload all three files to your web server
2. Navigate to the Admin Panel
3. Approve or decline a pending request
4. Check your email inbox!

## How It Works

When an admin approves or declines a request:
1. The system updates the request status
2. An email is automatically sent to the employee
3. The email includes all request details and the decision
4. If email sending fails, it won't break the app - it just logs an error

## Email Template Variables

The following variables are available in your email template:

- `{{employee_name}}` - Name of the employee
- `{{request_type}}` - Type of request (Holiday, Sick Leave, Bereavement Leave)
- `{{start_date}}` - Start date of the request (formatted)
- `{{end_date}}` - End date of the request (formatted)
- `{{days}}` - Number of days requested
- `{{status}}` - APPROVED or DECLINED
- `{{half_day_period}}` - Shows "(AM)" or "(PM)" if it's a half-day request
- `{{status_color}}` - Green (#28a745) for approved, Red (#dc3545) for declined

## Customization

You can customize the email template in your EmailJS dashboard at any time. The changes will take effect immediately without needing to update your code.

## Troubleshooting

### Emails not sending?

1. Check the browser console (F12) for error messages
2. Verify your Service ID, Template ID, and Public Key are correct
3. Make sure your email service is active in EmailJS
4. Check your EmailJS usage limits (free tier has 200 emails/month)

### Want to test without setting up emails?

The system will work perfectly fine without email configuration. It will just log a message to the console instead of sending emails.

## Alternative Email Options

If you prefer not to use EmailJS, you can modify the `sendEmailNotification` function in `script.js` to use:

- **Formspree** - Another form submission service
- **Custom API** - Connect to your own backend email service
- **Zapier/Make** - Use automation platforms to handle emails
- **SendGrid/Mailgun** - For larger scale operations

Just replace the `emailjs.send()` call with your preferred service's API.

---

## Questions?

If you need help setting this up, feel free to ask! The email notification feature is now integrated and ready to use once you configure your EmailJS account.
