# Third-party notices

Markdown Studio vendors a small number of libraries inside `vendor/` so the app
runs fully offline and without a build step. Each library keeps its upstream
license; their source and license are listed below.

| File | Project | Upstream | License |
| --- | --- | --- | --- |
| `vendor/marked.min.js` | marked | https://github.com/markedjs/marked (v12.0.2) | MIT |
| `vendor/purify.min.js` | DOMPurify | https://github.com/cure53/DOMPurify (v3.0.9) | Apache-2.0 OR MPL-2.0 (dual) |
| `vendor/highlight.min.js` | highlight.js | https://github.com/highlightjs/highlight.js (v11.9.0, common bundle) | BSD-3-Clause |

The interface icons are inline SVGs generated from the
[Lucide](https://lucide.dev) icon set (ISC license) by
`scripts/build-icons.mjs`.

Licenses for the above projects are included below in abbreviated form; see the
linked repositories for the full texts.

---

## marked — MIT

Copyright (c) 2011-2022, Christopher Jeffrey

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions: The above copyright notice and this
permission notice shall be included in all copies or substantial portions of the
Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## DOMPurify — Apache-2.0 OR MPL-2.0

Copyright (c) 2015-2023, Cure53 and other contributors

Licensed under the Apache License, Version 2.0 or the Mozilla Public License
2.0 at your option. You may obtain copies of the licenses at
https://www.apache.org/licenses/LICENSE-2.0 and
https://www.mozilla.org/MPL/2.0/. Unless required by applicable law or agreed
to in writing, software distributed under the Licenses is distributed on an "AS
IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.

## highlight.js — BSD-3-Clause

Copyright (c) 2006, Ivan Sagalaev (highlight.js)

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met: Redistributions of
source code must retain the above copyright notice, this list of conditions and
the following disclaimer. Redistributions in binary form must reproduce the
above copyright notice, this list of conditions and the following disclaimer in
the documentation and/or other materials provided with the distribution.
Neither the name of the copyright holder nor the names of its contributors may
be used to endorse or promote products derived from this software without
specific prior written permission. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT
HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES ARE
DISCLAIMED.

## Lucide — ISC

Copyright (c) 2020, Lucide Contributors

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS
IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE.
