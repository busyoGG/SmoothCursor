import { Plugin } from 'obsidian';
import { SmoothCursorSettingTab } from 'src/setting';

interface SelectionModify extends Selection {
	modify(alter?: string, direction?: string, granularity?: string): void;
}

interface SmoothCursorPluginSettings {
	/** 拖尾步数，越大越慢 */
	trailStep: number;

	/** 是否启用拖尾效果 */
	enableTrail: boolean;

	// /** 光标颜色 */
	// cursorColor: string;

	/** 拖尾颜色 */
	trailColor: string;
	trailColorDark: string;

	// /** 光标闪烁速度 */
	// blinkSpeed: number;
}

const DEFAULT_SETTINGS: SmoothCursorPluginSettings = {
	trailStep: 30,
	enableTrail: true,
	// cursorColor: "#ffffff",
	trailColor: "#78dce8",
	trailColorDark: "#78dce8",
	// blinkSpeed: 1
};

export default class SmoothCursorPlugin extends Plugin {

	// ----- 暴露的设置 -----
	setting: SmoothCursorPluginSettings;

	// ----- 私有变量 -----

	editorDom: HTMLElement;
	observer: MutationObserver | null = null;
	settingObserver: MutationObserver | null = null;

	canvas: HTMLCanvasElement | null;

	cursor: HTMLElement | null;
	vimText: HTMLElement | null;
	endOffset: number;
	endContainerRangeRect: DOMRect;

	isMouseMove: boolean = false;
	isMouseDown: boolean = false;
	isDomChanged: boolean = false;

	lastPos: { x: number, y: number, height: number } = { x: 0, y: 0, height: 0 };

	rectangle: { x: number, y: number, dirX: number, dirY: number, extTarget: number, extOrigin: number } =
		{ x: 0, y: 0, dirX: 0, dirY: 0, extTarget: 0, extOrigin: 0 };

	trailCount: number;

	isScroll: boolean = false;

	isInited: boolean = false;

	isFirstTrail: boolean = true;

	isSpanChange: boolean = false;

	// filePath: string;

	customStyle: HTMLStyleElement;
	vimStyle: HTMLStyleElement;

	focus: boolean = true;

	closeSettings: boolean = false;

	async onload() {

		// this.filePath = `${this.app.vault.configDir}/plugins/SmoothCursor/styles.css`;  // CSS 文件路径

		// console.log(this.filePath);

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
		this.canvas?.remove();

		this.stopObserving();
	}

	isVimMode(): boolean {
		return document.querySelector('.cm-vimCursorLayer') !== null;
	}

	init() {

		this.editorDom = document.querySelector('.cm-editor') as HTMLElement;

		if (!this.editorDom) {
			console.error("未打开文档");
			return;
		}

		this.isInited = true;

		// 创建一个自定义光标
		this.cursor = this.app.workspace.containerEl.createDiv({ cls: "smooth-cursor-busyo" });
		this.cursor.id = "smooth-cursor-busyo";
		this.editorDom.appendChild(this.cursor);

		this.vimText = this.app.workspace.containerEl.createDiv();
		this.cursor.appendChild(this.vimText);

		this.vimText.classList.add("vim-text");

		//延迟10帧，防止在样式加载完成前执行
		this.delayedFrames(() => {
			// 获取所有的 style 标签
			const styles = document.querySelectorAll('style');

			// 要查找的特定 CSS 规则（例如，查找包含 'color' 的规则）
			const ruleName = 'smooth-cursor-busyo';
			const vimText = 'vim-text';

			for (let index = 0; index < styles.length; index++) {
				let style = styles[index];
				let cssText = style.textContent as string;

				// 检查 CSS 内容是否包含特定的规则
				if (cssText.includes(ruleName)) {
					this.customStyle = style;
					// break;
				}

				if (cssText.includes(vimText)) {
					this.vimStyle = style;
				}
			}
		}, 10);

		this.createTrail();

		if (!this.setting.enableTrail) {
			this.cursor.addClass("show");
		}

		this.registerDomEvent(this.editorDom, "mousedown", (event) => {

			this.isMouseDown = true;

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
			if (!this.isDomChanged) {
				this.updateCursor();
			}
		});

		this.registerDomEvent(this.editorDom, "keyup", () => {
			if (!this.isDomChanged) {
				this.updateCursor();
			}
		});

		this.registerEvent(this.app.workspace.on("resize", () => {
			// this.isResize = true;
			if (this.canvas) {
				this.canvas.width = window.innerWidth;
				this.canvas.height = window.innerHeight;
			}

			this.isScroll = true;
			this.updateCursor();
		}));

		// let scroller = document.querySelector('.cm-scroller');

		this.registerDomEvent(this.editorDom.querySelector(".cm-scroller") as HTMLElement, "scroll", () => {
			this.isScroll = true;
			this.updateCursor();
		});

		this.lastPos = this.getCursorPosition();

		this.startObserving();

		//检测不在编辑器内
		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
			// console.log(leaf?.view.getViewType());
			if (leaf && leaf.view.containerEl.contains(this.editorDom)) {
				this.focus = true;
				document.body.addClass("caret-hide");
				this.cursor?.addClass("show");
			} else {
				this.focus = false;
				document.body.removeClass("caret-hide");
				this.cursor?.removeClass("show");
			}
		}));

		//默认隐藏系统光标
		document.body.addClass("caret-hide");
	}


	/**
	 * 更新光标坐标
	 */
	updateCursor(inputPos: { x: number, y: number, height: number } | null = null) {
		if (!this.cursor || !this.customStyle) return;
		// console.trace('Calling stack trace');

		// console.log("鼠标移动");

		// //判断是否是文本，是则移动，不是则不移动
		// let selection = window.getSelection();
		// if (selection && selection.rangeCount > 0) {
		// 	const range = selection.getRangeAt(0); // 获取当前选区
		// 	const endContainer = range.endContainer;
		// 	if (endContainer! instanceof Text) {
		// 		console.log("该节点不是文本节点，不移动");
		// 		return;
		// 	}
		// }

		this.closeSettings = false;

		let pos;
		if (inputPos) {
			pos = inputPos;
		} else {
			pos = this.getCursorPosition();
		}

		const scrollX = window.scrollX || document.documentElement.scrollLeft;
		const scrollY = window.scrollY || document.documentElement.scrollTop;

		if (this.isScroll) {
			this.cursor.addClass("noTrans");
		} else {
			this.cursor.removeClass("noTrans");
		}

		//vim 模式下方块光标文本更新
		if (this.isVimMode()) {
			let str = this.getNextCharAfterCursor();
			console.log(str);
			if (str) {
				this.vimText && (this.vimText.textContent = str.text);
				this.vimStyle.textContent = (this.vimStyle.textContent as string).replace(/(--vim-font-size:\s*[^;]+;)/, `--vim-font-size: ${str.size};`);
			} else {
				this.vimText && (this.vimText.textContent = "");
			}
		} else {
			this.vimText && (this.vimText.textContent = "");
		}

		// 修改坐标，该部分样式为自动计算，仅用于坐标变化
		//change position, the style is automatically calculated and is used only for coordinate changes
		let content = (this.customStyle.textContent as string).replace(/(--cursor-x:\s*[^;]+;)/, `--cursor-x: ${pos.x + scrollX};`);
		content = content.replace(/(--cursor-y:\s*[^;]+;)/, `--cursor-y: ${pos.y + scrollY};`);
		content = content.replace(/(--cursor-height:\s*[^;]+;)/, `--cursor-height: ${pos.height};`);

		this.customStyle.textContent = content;

		if (this.setting.enableTrail && !this.isScroll) {
			if (this.lastPos.x != pos.x || this.lastPos.y != pos.y) {
				this.updateTrail(this.lastPos.x, this.lastPos.y, pos.x, pos.y, pos.height, this.lastPos.height);
			}
		}

		if (this.setting.enableTrail && this.cursor.hasClass("noAni")) {
			this.cursor.removeClass("noAni");
		} else if (!this.setting.enableTrail) {
			this.cursor.addClass("noAni");
			setTimeout(() => {
				this.cursor?.removeClass("noAni");
			}, 80);
		}

		this.lastPos = pos;

		if (this.isDomChanged && !this.isMouseMove && this.isSpanChange) {
			const sel = window.getSelection();
			if (sel && sel.rangeCount > 0) {
				const range = sel.getRangeAt(0); // 获取当前选区
				const startContainer = range.startContainer;
				const endContainer = range.endContainer;

				// 判断前面是否有内容
				const canMoveBackward = (startContainer.textContent as string).length > 0 && range.startOffset > 0;
				// 判断后面是否有内容
				const canMoveForward = (endContainer.textContent as string).length > 0 && range.endOffset < (endContainer.textContent as string).length;

				if (canMoveBackward) {
					// 如果前面有内容，先向后移一位
					(sel as SelectionModify).modify("move", "backward", "character");
					// 然后再向前移一位
					(sel as SelectionModify).modify("move", "forward", "character");
				} else if (canMoveForward) {
					// 如果后面有内容，先向前移一位
					(sel as SelectionModify).modify("move", "forward", "character");
					// 然后再向后移一位
					(sel as SelectionModify).modify("move", "backward", "character");
				}
			}
		}

		this.isScroll = false;
		this.isDomChanged = false;
		this.isSpanChange = false;
	}

	getNextCharAfterCursor() {
		const selection = window.getSelection();
		if (!selection?.rangeCount) return null;

		const range = selection.getRangeAt(0).cloneRange();

		if (!(range.endContainer instanceof Text) || !range.endContainer.textContent || range.endOffset >= range.endContainer.textContent?.length) return null;
		// 扩展范围 1 个字符
		range.setEnd(range.endContainer, range.endOffset + 1);

		// 向上找到一个 Element 节点
		const element = (range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement) as Element;

		let fontSize = "16px";
		if (element) {
			fontSize = window.getComputedStyle(element).fontSize;
		}

		return {
			text: range.toString().slice(-1),
			size: fontSize
		}; // 只取新增字符
	}

	// 获取当前光标位置的函数
	getCursorPosition() {
		const selection = document.getSelection();
		if (selection && selection.rangeCount > 0) {
			let editorDomRect = this.editorDom.getBoundingClientRect();

			let range = selection.getRangeAt(0).cloneRange();

			let startContainer = range.startContainer as HTMLElement;
			let endContainer = range.endContainer as HTMLElement;

			//计算光标位置
			if (!this.isMouseMove && !this.isDomChanged) {
				range.setStart(endContainer, range.endOffset);
				range.setEnd(endContainer, range.endOffset);
				// console.log("非选择，非DOM变化", endContainer, this.endContainerRangeRect);
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
					// console.log('下行', endContainer, rangeCloneRect.top, this.endContainerRangeRect.top);
				} else {

					rangeClone.setStart(startContainer, range.startOffset);
					rangeClone.setEnd(startContainer, range.startOffset);

					rangeCloneRect = rangeClone.getClientRects()[0];
					if (!rangeCloneRect) {
						rangeCloneRect = startContainer.getBoundingClientRect();
					}

					if (rangeCloneRect.top < this.endContainerRangeRect.top) {
						range.setStart(startContainer, range.startOffset);
						range.setEnd(startContainer, range.startOffset);
						// console.log('上行', startContainer, rangeCloneRect.top, this.endContainerRangeRect.top);
					} else {
						if (rangeClone.endOffset > this.endOffset) {
							let endContainerLength = endContainer.textContent ? endContainer.textContent.length : 0;
							let offset = endContainerLength > rangeClone.endOffset ? rangeClone.endOffset : endContainerLength;
							range.setStart(endContainer, offset);
							range.setEnd(endContainer, offset);
							// console.log('同行1', rangeClone.endOffset, this.endOffset, offset);
						} else {
							range.setStart(startContainer, rangeClone.startOffset);
							range.setEnd(startContainer, rangeClone.startOffset);
							// console.log('同行2', rangeClone.endOffset, this.endOffset);
						}
					}
				}
			}

			let rect = range.getClientRects()[0];
			if (!rect) {
				rect = (range.endContainer as HTMLElement).getBoundingClientRect();
			}

			// if (range.endContainer.textContent && range.endOffset < range.endContainer.textContent?.length - 1) {
			// 	let tempRange = range.cloneRange();
			// 	tempRange.select
			// }

			// console.log(rect, range.startOffset, range.endOffset, endOffset);

			// 计算光标位置相对于编辑区域
			return {
				x: rect.x + window.scrollX - editorDomRect.x,
				y: rect.y + window.scrollY - editorDomRect.y,
				height: rect.height,
				// width: 3
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

					// if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
					// 	changed = true;
					// 	break; // 只要检测到增删，就退出循环
					// }

					for (let i = 0; i < mutation.addedNodes.length; i++) {
						if (mutation.addedNodes[i].nodeName != "BR") {
							changed = true;
							// break;
							if (mutation.addedNodes[i].nodeName == "SPAN") {
								this.isSpanChange = true;
							}
						}
					}

					for (let i = 0; i < mutation.removedNodes.length; i++) {
						if (mutation.removedNodes[i].nodeName != "BR") {
							changed = true;
							// break;
							if (mutation.removedNodes[i].nodeName == "SPAN") {
								this.isSpanChange = true;
							}
						}
					}
				}
			}

			if (changed) {
				this.isDomChanged = true;
				// setTimeout(() => {
				// }, 80);
				this.delayedFrames(() => {
					this.updateCursor();
				});
			}
		});

		this.settingObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === 'childList') {

					for (let i = 0; i < mutation.addedNodes.length; i++) {
						if (mutation.addedNodes[i].nodeName == "DIV" && (mutation.addedNodes[i] as HTMLDivElement).classList.contains("modal-container")) {
							// console.log("Obsidian 设置面板（模态框）已打开");
							this.focus = false;
							document.body.removeClass("caret-hide");
							this.cursor?.removeClass("show");
							break;
						}
					}

					for (let i = 0; i < mutation.removedNodes.length; i++) {
						if (mutation.removedNodes[i].nodeName == "DIV" && (mutation.removedNodes[i] as HTMLDivElement).classList.contains("modal-container")) {
							// console.log("Obsidian 设置面板（模态框）已关闭");
							this.focus = true;
							document.body.addClass("caret-hide");
							// this.cursor?.addClass("show");
							this.closeSettings = true;
							break;
						}
					}
				}
			}
		});

		// 监听子元素变化（比如标题的修改）
		this.observer.observe(root, {
			childList: true,      // 监听子节点添加/删除
			subtree: true,        // 监听整个子树
			// characterData: true,  // 监听文本变化
		});

		this.settingObserver.observe(document.body, {
			childList: true,      // 监听子节点添加/删除
			subtree: true,        // 监听整个子树
		});
	}

	stopObserving() {
		this.observer?.disconnect();
		this.observer = null;

		this.settingObserver?.disconnect();
		this.settingObserver = null;
	}

	delayedFrames(callback: Function, delay: number = 2) {
		let frameCount = 0;
		function run() {
			// 增加帧计数
			frameCount++;

			// 如果已经过了两帧，则执行目标操作
			if (frameCount === delay) {
				callback();
			} else {
				// 否则继续请求下一帧
				requestAnimationFrame(run);
			}
		}

		// 开始请求第一帧
		requestAnimationFrame(run);
	}

	/** 创建canvas */
	createTrail() {
		let self = this;
		// 创建拖尾画布

		this.canvas = this.editorDom.createEl("canvas", { cls: "smooth-cursor-busyo-canvas" });
		this.canvas.id = "trail-canvas";

		const ctx = this.canvas.getContext("2d");

		this.canvas.width = this.editorDom.innerWidth;
		this.canvas.height = this.editorDom.innerHeight;

		// 绘制拖尾
		function drawTrail() {
			if (self.canvas === null || ctx === null)
				return;

			if (self.cursor && self.trailCount <= 0) {
				ctx.clearRect(0, 0, self.canvas.width, self.canvas.height);
				self.focus && !self.closeSettings && self.cursor.addClass("show");
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

		animate(); // 启动动画循环
	}



	updateTrail(lastX: number, lastY: number, x: number, y: number, widthTarget: number, widthOrigin: number) {
		if (this.cursor === null) return;

		if (this.isFirstTrail) {
			this.isFirstTrail = false;
			this.cursor.addClass("show");
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

		this.cursor.removeClass("show");
	}

	async loadSettings() {
		this.setting = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		// this.app.vault.adapter.read(this.filePath).then((data) => {
		// 	// console.log("Plugin settings:", data);
		// 	// 正则表达式分别匹配 --cursor-color 和 --cursor-blink-speed 的值
		// 	const colorRegex = /--cursor-color:\s*([^;]+);/;
		// 	const blinkSpeedRegex = /--cursor-blink-speed:\s*([^;]+);/;

		// 	// 获取匹配结果
		// 	const colorMatch = colorRegex.exec(data);
		// 	const blinkSpeedMatch = blinkSpeedRegex.exec(data);

		// 	// 第一个匹配项
		// 	if (colorMatch && colorMatch[1]) {
		// 		// --cursor-color 的值
		// 		this.setting.cursorColor = colorMatch[1];
		// 	}
		// 	if (blinkSpeedMatch && blinkSpeedMatch[1]) {
		// 		// --cursor-blink-speed 的值
		// 		this.setting.blinkSpeed = Number(blinkSpeedMatch[1]);
		// 	}

		// 	// console.log('读取设置成功:', this.setting, colorMatch, blinkSpeedMatch);

		// 	this.saveSettings();

		// }).catch((error) => {
		// 	console.error("Failed to read settings:", error);
		// });
	}

	async saveSettings() {
		await this.saveData(this.setting);
	}

	updateSetting() {
		if (!this.cursor) return;
		// this.modifyCSS();
	}

	// async modifyCSS() {
	// 	let data = await this.app.vault.adapter.read(this.filePath);

	// 	if (!data) {
	// 		console.error('读取文件失败:', this.filePath);
	// 		return;
	// 	}

	// 	// 修改内容（在这里，你可以进行任何修改）
	// 	let content = data.replace(/(--cursor-color:\s*[^;]+;)/, `--cursor-color: ${this.setting.cursorColor};`);
	// 	content = content.replace(/(--cursor-blink-speed:\s*[^;]+;)/, `--cursor-blink-speed: ${this.setting.blinkSpeed};`);

	// 	await this.app.vault.adapter.write(this.filePath, content);

	// 	this.customStyle.textContent = content;
	// }
}