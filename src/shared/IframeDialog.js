/**
 * A simple, reusable dialog utility for use within the module editor iframe.
 */
export class IframeDialog {
    constructor(doc) {
        this.doc = doc; // The iframe's document
        this.dialogElement = null;
    }

    /**
     * Opens a dialog with the specified options.
     * @param {object} options
     * @param {string} options.title - The dialog title.
     * @param {string} options.content - The HTML content for the dialog body.
     * @param {Array<object>} options.buttons - Array of button configurations.
     *   - { text: string, className: string, onClick: (dialog) => void }
     */
    open({ title, content, buttons }) {
        // Close any existing dialog
        this.close();

        const dialogHTML = `
            <div class="iframe-dialog-overlay">
                <div class="iframe-dialog-content">
                    <div class="iframe-dialog-header">
                        <h3 class="iframe-dialog-title">${title}</h3>
                        <button class="iframe-dialog-close">✕</button>
                    </div>
                    <div class="iframe-dialog-body">
                        ${content}
                    </div>
                    <div class="iframe-dialog-footer">
                        <!-- Buttons will be added here -->
                    </div>
                </div>
            </div>
        `;

        const template = this.doc.createElement('template');
        template.innerHTML = dialogHTML;
        this.dialogElement = template.content.firstElementChild;

        const footer = this.dialogElement.querySelector('.iframe-dialog-footer');
        if (buttons && buttons.length > 0) {
            buttons.forEach(btnConfig => {
                const button = this.doc.createElement('button');
                button.textContent = btnConfig.text;
                // Use the existing button classes from the editor
                button.className = `${btnConfig.className || 'btn-secondary'}`;
                button.style.padding = '6px 12px';
                button.style.fontSize = '13px';

                // 支持左对齐 (将按钮推到左边，利用 flex 布局)
                if (btnConfig.align === 'left') {
                    button.style.marginRight = 'auto';
                }

                button.addEventListener('click', () => {
                    if (btnConfig.onClick) {
                        btnConfig.onClick(this);
                    } else {
                        this.close();
                    }
                });
                footer.appendChild(button);
            });
        }

        this.dialogElement.querySelector('.iframe-dialog-close').addEventListener('click', () => this.close());
        // 遮罩关闭：仅当 mousedown 与 click 都落在 overlay 本身才关，
        // 避免从弹窗内拖选文字到遮罩释放被误判为点遮罩而关闭。
        let downOnOverlay = false;
        this.dialogElement.addEventListener('mousedown', (e) => {
            downOnOverlay = (e.target === this.dialogElement);
        });
        this.dialogElement.addEventListener('click', (e) => {
            if (downOnOverlay && e.target === this.dialogElement) {
                this.close();
            }
            downOnOverlay = false;
        });

        this.doc.body.appendChild(this.dialogElement);

        // Animate in
        setTimeout(() => this.dialogElement.classList.add('show'), 10);
    }

    close() {
        if (this.dialogElement) {
            this.dialogElement.classList.remove('show');
            // Allow animation to finish before removing
            setTimeout(() => {
                if (this.dialogElement && this.dialogElement.parentNode) {
                    this.dialogElement.parentNode.removeChild(this.dialogElement);
                }
                this.dialogElement = null;
            }, 300);
        }
    }
}