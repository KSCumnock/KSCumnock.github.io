// Cloudflare Worker for GitHub API Proxy
// Deploy this to your worker at: https://ks-holiday-manager.ske-d03.workers.dev/
// Make sure to set the secret: GitHubToken

export default {
  async fetch(request, env) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only allow POST requests to /api/github
    if (request.method !== 'POST' || !request.url.endsWith('/api/github')) {
      return new Response('Not Found', { status: 404 });
    }

    try {
      const body = await request.json();
      const { action, owner, repo, path, content, sha, message, branch } = body;

      // Get GitHub token from environment secret
      const githubToken = env.GitHubToken;
      
      if (!githubToken) {
        return new Response(JSON.stringify({ error: 'GitHub token not configured' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const githubApiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

      if (action === 'get') {
        // GET request to fetch file
        const response = await fetch(githubApiUrl, {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Cloudflare-Worker',
            'X-GitHub-Api-Version': '2022-11-28'
          }
        });

        if (!response.ok) {
          if (response.status === 404) {
            return new Response(JSON.stringify({ error: 'File not found' }), {
              status: 404,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          const errorText = await response.text();
          console.error('GitHub GET error:', response.status, response.statusText, errorText);
          throw new Error(`GitHub API error: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Decode base64 content (remove line breaks first)
        const base64Content = data.content.replace(/\n/g, '');
        const decodedContent = JSON.parse(atob(base64Content));
        
        return new Response(JSON.stringify({
          content: decodedContent,
          sha: data.sha
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } else if (action === 'update') {
        // PUT request to update file
        const requestBody = {
          message: message,
          content: btoa(JSON.stringify(content, null, 2)),
          branch: branch || 'main'
        };

        if (sha) {
          requestBody.sha = sha;
        }

        const response = await fetch(githubApiUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'Cloudflare-Worker',
            'X-GitHub-Api-Version': '2022-11-28'
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('GitHub PUT error:', response.status, response.statusText, errorText);
          throw new Error(`GitHub API error: ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } else {
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        error: error.message || 'Internal server error' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
