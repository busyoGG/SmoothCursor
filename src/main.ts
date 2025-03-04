import { Plugin } from 'obsidian';
import { SmoothCursorSettingTab } from 'src/setting';

// Remember to rename these classes and interfaces!

interface SmoothCursorPluginSettings {
	/** 拖尾步数，越大越慢 */
	trailStep: number;

	/** 是否启用拖尾效果 */
	enableTrail: boolean;

	/** 光标颜色 */
	cursorColor: string;

	/** 拖尾颜色 */
	trailColor: string;

	/** 光标闪烁速度 */
	blinkSpeed: number;
}

const DEFAULT_SETTINGS: SmoothCursorPluginSettings = {
	trailStep: 30,
	enableTrail: true,
	cursorColor: "#ffffff",
	trailColor: "#78dce8",
	blinkSpeed: 1
};

export default class SmoothCursorPlugin extends Plugin {

	// ----- 暴露的设置 -----
	setting: SmoothCursorPluginSettings;

	// ----- 私有变量 -----

	editorDom: HTMLElement;
	observer: MutationObserver | null = null;

	style: HTMLStyleElement;
	canvas: HTMLCanvasElement | null;

	cursor: HTMLElement | null;
	endOffset: any;
	endContainerRangeRect: any;

	isMouseMove: boolean = false;
	isMouseDown: boolean = false;
	isDomChanged: boolean = false;

	lastPos: any = { x: 0, y: 0, height: 0 };

	delayTimer: any;

	rectangle: { x: number, y: number, dirX: number, dirY: number, extTarget: number, extOrigin: number } =
		{ x: 0, y: 0, dirX: 0, dirY: 0, extTarget: 0, extOrigin: 0 };

	trailCount: number;

	isScroll: boolean = false;

	isStyleInit: boolean = false;

	isInited: boolean = false;

	isAnimationInit: boolean = false;

	isFirstTrail: boolean = true;

	async onload() {

		// 设置默认设置
		await this.loadSettings();

		this.addSettingTab(new SmoothCursorSettingTab(this.app, this))

		this.app.workspace.onLayoutReady(() => {

			this.app.workspace.on("file-open", (file) => {
				if (file === null) {
					this.isInited = false;
					this.isFirstTrail = true;
					this.cursor = null;
					this.canvas = null;
					this.trailCount = 0;
				} else if (!this.isInited) {
					this.init();
				}
			});

			this.init();
		});
	}

	onunload() {
		this.cursor?.remove();
		this.style.remove();
		this.canvas?.remove();

		this.stopObserving();

		// document.documentElement.style.setProperty('--caret-color', 'var(--text-normal)');
	}

	init() {

		this.editorDom = document.querySelector('.cm-editor') as HTMLElement;

		if (!this.editorDom) {
			console.log("未打开文档");
			return;
		}

		this.isInited = true;

		// 创建一个自定义光标
		this.cursor = document.createElement("div");
		this.cursor.id = "custom-cursor";
		this.editorDom.appendChild(this.cursor);

		if (!this.isStyleInit) {
			this.isStyleInit = true;
			// 设置光标样式
			this.style = document.createElement("style");
			this.style.innerHTML = `
			#custom-cursor {
				position: absolute;
				width: 3px;
				height: 20px;
				background-color: ${this.setting.cursorColor};
				pointer-events: none;
				left: 0;
				top: 0;
				transition: all 0.08s ease-out;
				display: none;
				animation: blink ${this.setting.blinkSpeed}s infinite;
			}
			body{
				--caret-color: transparent !important;
			}

			/* 定义 @keyframes 动画 */
			@keyframes blink {
				0%, 100% {
					opacity: 1;
				}
				50% {
					opacity: 0.05;
				}
			}
			`;
			document.head.appendChild(this.style);
		}

		this.createTrail();

		if (!this.setting.enableTrail) {
			this.cursor.style.display = "block";
		}

		this.registerDomEvent(this.editorDom, "mousedown", () => {

			this.isMouseDown = true;
			//给点延迟，用于等待界面变化
			this.delayTimer = setTimeout(() => {

				const selection = this.editorDom.ownerDocument.getSelection();
				if (selection && selection.rangeCount > 0) {
					const range = selection.getRangeAt(0);

					this.endOffset = range.endOffset;

					let endContainerRange = range.cloneRange();
					endContainerRange.setStart(range.endContainer, range.endOffset);
					endContainerRange.setEnd(range.endContainer, range.endOffset);

					this.endContainerRangeRect = endContainerRange.getClientRects()[0];
					if (!this.endContainerRangeRect) {
						this.endContainerRangeRect = (range.endContainer as Element).getBoundingClientRect();
					}
				}
				this.updateCursor();
			}, 100);
		});

		this.registerDomEvent(this.editorDom, "mousemove", (evt) => {
			if (this.isMouseDown) {

				// clearTimeout(this.delayTimer);
				this.isMouseMove = true;
				this.updateCursor();
			}
		});

		this.registerDomEvent(this.editorDom, "mouseup", () => {

			this.isMouseDown = false;
			this.isMouseMove = false;
		});

		this.registerDomEvent(this.editorDom, "keydown", () => {
			this.updateCursor();
		});

		this.registerDomEvent(this.editorDom, "keyup", () => {
			this.updateCursor();
		});

		this.app.workspace.on("resize", () => {
			// this.isResize = true;
			if (this.canvas) {
				this.canvas.width = window.innerWidth;
				this.canvas.height = window.innerHeight;
			}

			this.isScroll = true;
			this.updateCursor();
		});

		// let scroller = document.querySelector('.cm-scroller');

		this.registerDomEvent(this.editorDom, "scroll", () => {
			this.isScroll = true;
			this.updateCursor();
		});

		this.lastPos = this.getCursorPosition();

		this.startObserving();
	}


	updateCursor() {
		if (!this.cursor) return;
		// console.trace('Calling stack trace');
		let pos = this.getCursorPosition();

		const scrollX = window.scrollX || document.documentElement.scrollLeft;
		const scrollY = window.scrollY || document.documentElement.scrollTop;

		if (this.isScroll) {
			this.cursor.style.transition = "none";
		} else {
			this.cursor.style.transition = "all 0.08s ease-out";
		}

		this.cursor.style.left = `${pos.x + scrollX}px`;
		this.cursor.style.top = `${pos.y + scrollY}px`;
		this.cursor.style.height = `${pos.height}px`;

		if (this.setting.enableTrail && !this.isScroll) {
			if (this.lastPos.x != pos.x || this.lastPos.y != pos.y) {
				this.updateTrail(this.lastPos.x, this.lastPos.y, pos.x, pos.y, pos.height, this.lastPos.height);
			}
		}

		if (this.setting.enableTrail && this.cursor.style.animation === "none") {
			this.cursor.style.animation = `blink ${this.setting.blinkSpeed}s infinite`;
		} else if (!this.setting.enableTrail) {
			this.cursor.style.animation = "none";
			setTimeout(() => {
				this.cursor && (this.cursor.style.animation = `blink ${this.setting.blinkSpeed}s infinite`);
			}, 80);
		}

		this.lastPos = pos;

		// this.isResize = false;
		this.isScroll = false;
	}

	// 获取当前光标位置的函数
	getCursorPosition() {
		const selection = document.getSelection();
		if (selection && selection.rangeCount > 0) {
			let editorDomRect = this.editorDom.getBoundingClientRect();

			let range = selection.getRangeAt(0).cloneRange();

			let startContainer = range.startContainer as any;
			let endContainer = range.endContainer as any;

			//计算光标位置
			if (!this.isMouseMove && !this.isDomChanged) {
				range.setStart(endContainer, range.endOffset);
				range.setEnd(endContainer, range.endOffset);
				// console.log("非选择，非DOM变化", this.isMouseMove, this.isDomChanged);
			} else if (this.endContainerRangeRect) {
				let rangeClone = range.cloneRange();
				rangeClone.setStart(endContainer, range.endOffset);
				rangeClone.setEnd(endContainer, range.endOffset);

				let rangeCloneRect = rangeClone.getClientRects()[0];
				if (!rangeCloneRect) {
					rangeCloneRect = endContainer.getBoundingClientRect();
				}

				if (rangeCloneRect.top > this.endContainerRangeRect.top) {
					range.setStart(endContainer, range.endOffset);
					range.setEnd(endContainer, range.endOffset);
					// console.log('下行', rangeCloneRect.top, this.endContainerRangeRect.top);
				} else {

					rangeClone.setStart(startContainer, range.startOffset);
					rangeClone.setEnd(startContainer, range.startOffset);

					rangeCloneRect = rangeClone.getClientRects()[0];
					if (!rangeCloneRect) {
						rangeCloneRect = rangeClone.getBoundingClientRect();
					}

					if (rangeCloneRect.top < this.endContainerRangeRect.top) {
						range.setStart(startContainer, range.startOffset);
						range.setEnd(startContainer, range.startOffset);
						// console.log('上行', rangeCloneRect.top, this.endContainerRangeRect.top);
					} else {
						if (range.endOffset > this.endOffset) {
							let endContainerLength = endContainer.textContent ? endContainer.textContent.length : 0;
							let offset = endContainerLength > range.endOffset ? range.endOffset : endContainerLength;
							range.setStart(endContainer, offset);
							range.setEnd(endContainer, offset);
							// console.log('同行', range.endOffset, this.endOffset);
						} else {
							range.setStart(startContainer, range.startOffset);
							range.setEnd(startContainer, range.startOffset);
							// console.log('同行', range.endOffset, this.endOffset);
						}
					}
				}
			}

			let rect = range.getClientRects()[0];
			if (!rect) {
				rect = (range.endContainer as any).getBoundingClientRect();
			}

			// console.log(rect, range.startOffset, range.endOffset, endOffset);

			// 计算光标位置相对于编辑区域
			return {
				x: rect.x + window.scrollX - editorDomRect.x,
				y: rect.y + window.scrollY - editorDomRect.y,
				height: rect.height,
			};
		}

		return { x: 0, y: 0, height: 0 };  // 如果没有有效的选择，返回默认位置
	}

	startObserving() {
		// 获取 Obsidian 的 workspace 主体
		let root = document.querySelector('.cm-contentContainer');

		while (!root) {
			root = document.querySelector('.cm-contentContainer');
		}

		this.observer = new MutationObserver((mutations) => {
			let changed = false;

			for (const mutation of mutations) {
				if (mutation.type === 'childList') {
					changed = true;
					break; // 只要检测到增删，就退出循环
				}
			}

			if (changed) {
				this.isDomChanged = true;
				this.updateCursor();
				this.isDomChanged = false;
			}
		});

		// 监听子元素变化（比如标题的修改）
		this.observer.observe(root, {
			childList: true,      // 监听子节点添加/删除
			subtree: true,        // 监听整个子树
			// characterData: true,  // 监听文本变化
		});
	}

	stopObserving() {
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
	}

	/** 创建canvas */
	createTrail() {
		let self = this;
		// 创建拖尾画布
		this.canvas = document.createElement("canvas") as HTMLCanvasElement;
		this.canvas.id = "trail-canvas";

		// let editorDom = document.querySelector('.cm-editor') as HTMLElement;
		this.editorDom.appendChild(this.canvas);

		const ctx = this.canvas.getContext("2d");

		this.canvas.width = this.editorDom.innerWidth;
		this.canvas.height = this.editorDom.innerHeight;
		this.canvas.style.position = "absolute";
		this.canvas.style.top = "0";
		this.canvas.style.left = "0";
		this.canvas.style.pointerEvents = "none";
		this.canvas.style.zIndex = "0";

		// 绘制拖尾
		function drawTrail() {
			if (self.canvas === null || ctx === null)
				return;

			if (self.cursor && self.trailCount <= 0) {
				ctx.clearRect(0, 0, self.canvas.width, self.canvas.height);
				self.cursor.style.display = "block";
				return;
			}

			self.trailCount--;

			let ratio = self.trailCount / self.setting.trailStep;

			let targetX1 = self.rectangle.x - self.rectangle.dirX * 0.15 * Math.max(0, (-0.3 + ratio));
			let targetX2 = targetX1;

			let originX1 = self.rectangle.x - self.rectangle.dirX * ratio;
			let originX2 = originX1;

			if (self.rectangle.dirX === 3) {
				targetX1 = self.rectangle.x;
				targetX2 = targetX1;

				originX1 = self.rectangle.x - self.rectangle.dirX;
				originX2 = originX1;

			} else if (self.rectangle.dirY < 0) {
				targetX2 = self.rectangle.x - self.rectangle.dirX * 0.05 * Math.max(0, (-0.3 + ratio));
				originX1 = self.rectangle.x - self.rectangle.dirX * Math.max(0, (ratio - 0.02));
			} else if (self.rectangle.dirY > 0) {
				targetX1 = self.rectangle.x - self.rectangle.dirX * 0.05 * Math.max(0, (-0.3 + ratio));
				originX2 = self.rectangle.x - self.rectangle.dirX * Math.max(0, (ratio - 0.02));
			}

			let heightDiff = self.rectangle.extTarget - self.rectangle.extOrigin;

			ctx.clearRect(0, 0, self.canvas.width, self.canvas.height);

			ctx.beginPath();

			ctx.moveTo(targetX1, self.rectangle.y + self.rectangle.extTarget);
			ctx.lineTo(targetX2, self.rectangle.y);
			ctx.lineTo(originX1, self.rectangle.y - self.rectangle.dirY * ratio);
			ctx.lineTo(originX2, self.rectangle.y - self.rectangle.dirY * ratio + self.rectangle.extTarget - heightDiff * ratio);

			ctx.closePath();

			ctx.fillStyle = self.setting.trailColor; // 设置填充颜色
			ctx.fill(); // 填充形状
			// ctx.strokeStyle = "black"; // 设置描边颜色
			// ctx.stroke(); // 描边
		}

		// 动画循环
		function animate() {
			if (self.canvas === null) return;
			drawTrail(); // 绘制拖尾
			requestAnimationFrame(animate); // 继续动画
		}

		// // 监听鼠标事件
		// this.registerDomEvent(document, "mousemove", (e) => {
		// 	self.updateTrail(e.clientX, e.clientY); // 更新拖尾点
		// });

		// if (!this.isAnimationInit) {
		// 	this.isAnimationInit = true;
		// }
		animate(); // 启动动画循环
	}



	updateTrail(lastX: number, lastY: number, x: number, y: number, widthTarget: number, widthOrigin: number) {
		if (this.cursor === null) return;

		if (this.isFirstTrail) {
			this.isFirstTrail = false;
			this.cursor.style.display = "block";
			return;
		}

		let dx = x - lastX;
		let dy = y - lastY;
		this.rectangle.x = x;
		this.rectangle.y = y;
		this.rectangle.dirX = dx == 0 ? 3 : dx;
		this.rectangle.dirY = dy;

		this.rectangle.extTarget = widthTarget;
		this.rectangle.extOrigin = widthOrigin;

		this.trailCount = this.setting.trailStep;

		this.cursor.style.display = "none";
	}

	async loadSettings() {
		this.setting = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.setting);
	}

	updateSetting() {
		if (!this.cursor) return;
		this.cursor.style.backgroundColor = this.setting.cursorColor;
		this.cursor.style.animationDuration = `${this.setting.blinkSpeed}s`;
	}
}