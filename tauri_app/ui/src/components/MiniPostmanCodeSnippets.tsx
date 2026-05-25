import { useState } from "react";
import { Code, Copy, Check, ChevronDown, ChevronRight } from "lucide-react";

interface CurlInput {
  url: string;
  method: string;
  headers: { [key: string]: string };
  body?: string;
  body_type: string;
  auth_type: string;
  auth_value?: string;
}

export default function MiniPostmanCodeSnippets({ request }: { request: CurlInput }) {
  const [lang, setLang] = useState('curl');
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const generateSnippet = (): string => {
    const { url, method, headers, body, body_type, auth_type, auth_value } = request;

    switch (lang) {
      case 'curl': {
        let c = `curl -X ${method} "${url}"`;
        Object.entries(headers).forEach(([k, v]) => {
          if (k.trim()) c += ` \\\n  -H "${k}: ${v}"`;
        });
        if (auth_type === 'bearer' && auth_value) {
          c += ` \\\n  -H "Authorization: Bearer ${auth_value}"`;
        }
        if (body && body_type !== 'none') {
          if (body_type === 'json') {
            c += ` \\\n  -H "Content-Type: application/json"`;
          }
          c += ` \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
        }
        return c;
      }

      case 'python': {
        let lines: string[] = [];
        lines.push('import requests');
        lines.push('');
        lines.push(`url = "${url}"`);

        if (Object.keys(headers).length > 0 || (auth_type === 'bearer' && auth_value)) {
          lines.push('');
          lines.push('headers = {');
          Object.entries(headers).forEach(([k, v]) => {
            if (k.trim()) lines.push(`    "${k}": "${v}",`);
          });
          if (auth_type === 'bearer' && auth_value) {
            lines.push(`    "Authorization": "Bearer ${auth_value}",`);
          }
          lines.push('}');
        }

        let hasBody = body && body_type !== 'none';
        if (hasBody && body_type === 'json') {
          lines.push('');
          lines.push(`data = ${body}`);
        } else if (hasBody) {
          lines.push('');
          lines.push(`data = """${body}"""`);
        }

        lines.push('');
        if (auth_type === 'basic' && auth_value) {
          const [u, p] = auth_value.split(':');
          lines.push(`response = requests.${method.toLowerCase()}(
    url,
    headers=headers,
    auth=("${u}", "${p}"),
    ${hasBody ? 'data=data,' : ''}
)`);
        } else if (hasBody) {
          lines.push(`response = requests.${method.toLowerCase()}(url, headers=headers, data=data)`);
        } else if (lines.some(l => l.includes('headers'))) {
          lines.push(`response = requests.${method.toLowerCase()}(url, headers=headers)`);
        } else {
          lines.push(`response = requests.${method.toLowerCase()}(url)`);
        }
        lines.push('print(response.status_code)');
        lines.push('print(response.text)');
        return lines.join('\n');
      }

      case 'javascript': {
        let lines: string[] = [];
        lines.push('const url = new URL("' + url + '");');

        const hasHeaders = Object.keys(headers).length > 0 || (auth_type !== 'none' && auth_value);
        if (hasHeaders) {
          lines.push('const headers = {');
          Object.entries(headers).forEach(([k, v]) => {
            if (k.trim()) lines.push(`  "${k}": "${v}",`);
          });
          if (auth_type === 'bearer' && auth_value) {
            lines.push(`  "Authorization": "Bearer ${auth_value}",`);
          }
          lines.push('};');
        }

        let hasBody = body && body_type !== 'none';
        let bodyArg = '';
        if (hasBody) {
          if (body_type === 'json') {
            bodyArg = `\n  body: JSON.stringify(${body}),`;
          } else {
            bodyArg = `\n  body: \`${body}\`,`;
          }
        }

        lines.push('');
        lines.push(`fetch(url${hasHeaders ? ', {' : ''}`);
        lines.push(`  method: "${method}",${hasHeaders ? '' : ','}`);
        if (hasHeaders) {
          lines.push(`  headers,${bodyArg}`);
          lines.push('})');
        }
        lines.push('  .then(res => res.text())');
        lines.push('  .then(data => console.log(data))');
        lines.push('  .catch(err => console.error(err));');
        return lines.join('\n');
      }

      case 'go': {
        let lines: string[] = [];
        lines.push('package main');
        lines.push('');
        lines.push('import (');
        lines.push('    "fmt"');
        lines.push('    "io/ioutil"');
        lines.push('    "net/http"');
        lines.push('    "strings"');
        lines.push(')');
        lines.push('');
        lines.push('func main() {');
        lines.push(`    url := "${url}"`);

        let hasBody = body && body_type !== 'none';
        if (hasBody) {
          lines.push(`    payload := strings.NewReader(\`${body}\`)`);
        }
        lines.push('');
        lines.push(`    req, _ := http.NewRequest("${method}", url${hasBody ? ', payload' : ', nil'})`);

        Object.entries(headers).forEach(([k, v]) => {
          if (k.trim()) lines.push(`    req.Header.Set("${k}", "${v}")`);
        });
        if (auth_type === 'bearer' && auth_value) {
          lines.push(`    req.Header.Set("Authorization", "Bearer ${auth_value}")`);
        }

        lines.push('');
        lines.push('    client := &http.Client{}');
        lines.push('    resp, err := client.Do(req)');
        lines.push('    if err != nil {');
        lines.push('        fmt.Println(err)');
        lines.push('        return');
        lines.push('    }');
        lines.push('    defer resp.Body.Close()');
        lines.push('    body, _ := ioutil.ReadAll(resp.Body)');
        lines.push('    fmt.Println(string(body))');
        lines.push('}');
        return lines.join('\n');
      }

      case 'rust': {
        let lines: string[] = [];
        lines.push('use reqwest;');
        lines.push('');
        lines.push('#[tokio::main]');
        lines.push('async fn main() -> Result<(), Box<dyn std::error::Error>> {');
        lines.push(`    let client = reqwest::Client::new();`);

        let hasBody = body && body_type !== 'none';
        if (hasBody && body_type === 'json') {
          lines.push(`    let json_body = ${body};`);
        }

        lines.push(`    let mut req = client.request(reqwest::Method::${method.toUpperCase()}, "${url}")`);

        Object.entries(headers).forEach(([k, v]) => {
          if (k.trim()) lines.push(`        .header("${k}", "${v}")`);
        });
        if (auth_type === 'bearer' && auth_value) {
          lines.push(`        .bearer_auth("${auth_value}")`);
        }
        if (hasBody && body_type === 'json') {
          lines.push('        .json(&json_body)');
        } else if (hasBody) {
          lines.push(`        .body("${body?.replace(/"/g, '\\"')}")`);
        }

        lines.push('        .send()');
        lines.push('        .await?;');
        lines.push('    let body = req.text().await?;');
        lines.push('    println!("{}", body);');
        lines.push('    Ok(())');
        lines.push('}');
        return lines.join('\n');
      }

      case 'java': {
        let lines: string[] = [];
        lines.push('import java.net.http.*;');
        lines.push('import java.net.URI;');
        lines.push('');
        lines.push('public class ApiRequest {');
        lines.push('    public static void main(String[] args) throws Exception {');
        lines.push(`        HttpClient client = HttpClient.newHttpClient();`);
        lines.push(`        HttpRequest request = HttpRequest.newBuilder()`);
        lines.push(`            .uri(URI.create("${url}"))`);
        lines.push(`            .method("${method}", HttpRequest.BodyPublishers.noBody())`);
        Object.entries(headers).forEach(([k, v]) => {
          if (k.trim()) lines.push(`            .header("${k}", "${v}")`);
        });
        if (auth_type === 'bearer' && auth_value) {
          lines.push(`            .header("Authorization", "Bearer ${auth_value}")`);
        }
        lines.push(`            .build();`);
        lines.push('');
        lines.push('        HttpResponse<String> response = client.send(request,');
        lines.push('            HttpResponse.BodyHandlers.ofString());');
        lines.push('        System.out.println(response.body());');
        lines.push('    }');
        lines.push('}');
        return lines.join('\n');
      }

      default:
        return '// Select a language';
    }
  };

  const snippet = generateSnippet();

  const copySnippet = () => {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const languages = [
    { id: 'curl', label: 'cURL' },
    { id: 'python', label: 'Python' },
    { id: 'javascript', label: 'JavaScript' },
    { id: 'go', label: 'Go' },
    { id: 'rust', label: 'Rust' },
    { id: 'java', label: 'Java' },
  ];

  return (
    <div className="code-snippets-panel">
      <div className="snippets-header" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Code size={13} />
        <span className="font-bold text-xs">Code Snippets</span>
      </div>

      {expanded && (
        <div className="snippets-body">
          <div className="snippets-lang-bar">
            {languages.map(l => (
              <button
                key={l.id}
                className={`snippet-lang-btn ${lang === l.id ? 'active' : ''}`}
                onClick={() => setLang(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="snippet-code-wrapper">
            <button className="snippet-copy-btn" onClick={copySnippet}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
            <pre className="snippet-code">{snippet}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
