import fs from 'fs';

const filePath = 'src/components/Dashboard.tsx';
let content = fs.readFileSync(filePath, 'utf-8');

// Add imports
if (!content.includes('customPrompt')) {
  content = content.replace(
    "import { Activity, Shield, Zap, Skull, Clock as ClockIcon, Wind, ScrollText, Trash2, Plus, AlertTriangle, Cloud, MessageSquarePlus, Dices } from 'lucide-react';",
    "import { Activity, Shield, Zap, Skull, Clock as ClockIcon, Wind, ScrollText, Trash2, Plus, AlertTriangle, Cloud, MessageSquarePlus, Dices } from 'lucide-react';\nimport { customPrompt, customConfirm } from './PromptModal';"
  );
}

// Replace onClick={() => { with onClick={async () => {
content = content.replace(/onClick=\{\(\) => \{/g, 'onClick={async () => {');

// Replace onClick={() => updateChar... with onClick={async () => updateChar...
content = content.replace(/onClick=\{\(\) => updateChar/g, 'onClick={async () => updateChar');

// Replace onClick={() => onUpdate... with onClick={async () => onUpdate...
content = content.replace(/onClick=\{\(\) => onUpdate/g, 'onClick={async () => onUpdate');

// Replace onClick={() => { const current = ... with onClick={async () => { const current = ...
content = content.replace(/onClick=\{\(\) => \{\n\s*const current/g, 'onClick={async () => {\n                    const current');

// Replace prompt( with await customPrompt(
content = content.replace(/ prompt\(/g, ' await customPrompt(');

// Replace confirm( with await customConfirm(
content = content.replace(/ confirm\(/g, ' await customConfirm(');

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Done');
