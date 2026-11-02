// Builds app.css for the harness: the project's index.css without the Tailwind directives, plus a tiny shim for the few
// Tailwind utilities the page skeleton needs (so the harness does not need Tailwind installed).
const fs = require('fs');
const path = require('path');
let css = fs.readFileSync(path.join(__dirname, '../../src/index.css'), 'utf8');
for (const t of ['@tailwind base;', '@tailwind components;', '@tailwind utilities;']) css = css.replace(t, '');
const shim = `
*,*::before,*::after{box-sizing:border-box}
.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1 1 0%}.relative{position:relative}.absolute{position:absolute}.fixed{position:fixed}
.overflow-hidden{overflow:hidden}.inline-block{display:inline-block}.left-0{left:0}.top-0{top:0}.w-full{width:100%}.h-full{height:100%}
.hidden{display:none}.touch-none{touch-action:none}.items-center{align-items:center}.justify-between{justify-content:space-between}.gap-2{gap:.5rem}
.bg-emerald-900{background:#064e3b}.text-white{color:#fff}.flex-wrap{flex-wrap:wrap}.z-10{z-index:10}.z-20{z-index:20}.z-40{z-index:40}
.bg-amber-50{background:#fffbeb}.px-4{padding-left:1rem;padding-right:1rem}.py-2{padding-top:.5rem;padding-bottom:.5rem}
.bg-white{background:#fff}.bg-gray-100{background:#f3f4f6}.rounded-lg{border-radius:.5rem}.px-3{padding-left:.75rem;padding-right:.75rem}
`;
fs.writeFileSync(path.join(__dirname, 'app.css'), css + shim);
