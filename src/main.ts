import { Editor, MarkdownFileInfo, MarkdownView, Plugin, WorkspaceLeaf } from 'obsidian';
import { SmoothCursorSettingTab } from 'src/setting';
import { Editor as cmEditor } from "codemirror"

interface cmEditorExtention extends cmEditor {
	coordsForChar(offset: number): { left: number; top: number; right: number; bottom: number };
	domAtPos(offset: number): { node: Node; offset: number; precise: boolean; };
	coordsAtPos(pos: number): { left: number; top: number; right: number; bottom: number };
	dom: HTMLElement;
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

	curEditor: MarkdownFileInfo | null;

	fileIndex: { [key: string]: number } = {};

	editorDom: { [key: number]: HTMLElement } = {};
	observer: MutationObserver | null = null;
	settingObserver: MutationObserver | null = null;

	canvas: { [key: number]: HTMLCanvasElement } = {};

	cursor: { [key: number]: HTMLElement } = {};
	vimText: { [key: number]: HTMLElement } = {};

	isMouseDown: boolean = false;
	mouseForX: { down: number, move: number } = { down: 0, move: 0 };
	mouseForY: { down: number, move: number } = { down: 0, move: 0 };
	mouseMoveTaget: { down: HTMLElement, move: HTMLElement };

	customStyle: HTMLStyleElement;
	vimStyle: HTMLStyleElement;

	isScroll: boolean = false;

	focus: boolean = true;

	closeSettings: boolean = false;

	private events: Partial<{
		[K in keyof HTMLElementEventMap]: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any;
	}> = {};

	test: DOMRect;

	// ----- trail ------

	lastPos: { x: number, y: number, height: number }[] = [{ x: 0, y: 0, height: 0 }];

	lastPosForChangeFile: { x: number, y: number, height: number }[] = [{ x: 0, y: 0, height: 0 }];

	rectangle: { x: number, y: number, dirX: number, dirY: number, extTarget: number, extOrigin: number }[] =
		[{ x: 0, y: 0, dirX: 0, dirY: 0, extTarget: 0, extOrigin: 0 }];

	trailCount: number[] = [];

	isFirstTrail: { [key: number]: boolean } = {};

	async onload() {

		console.log("Smooth Cursor loaded");
		// 设置默认设置
		await this.loadSettings();

		this.addSettingTab(new SmoothCursorSettingTab(this.app, this))

		this.app.workspace.onLayoutReady(() => {

			let files = this.getAllOpenFilePaths();
			let firstFile = this.app.workspace.getActiveFile();
			if (firstFile) {
				this.fileIndex[firstFile.path] = Object.keys(this.fileIndex).length;;
				this.isFirstTrail[0] = true;
			}

			this.registerEvent(this.app.workspace.on("file-open", (file) => {

				// console.log("打开文件", file)

				//切换文件的时候清除光标和画布
				if (file !== null) {

					// let curFiles = this.getAllOpenFilePaths();
					// let diff = files.filter(x => !curFiles.includes(x));

					for (let i = 0; i < files.length; i++) {
						// console.log("关闭文件", this.fileIndex, files[i])
						this.uninit(this.fileIndex[files[i]]);
						delete this.fileIndex[files[i]];
					}

					files = this.getAllOpenFilePaths();


					this.fileIndex[file.path] = Object.keys(this.fileIndex).length;

					// this.isFirstTrail[this.fileIndex[file.path]] = true;
					//增加点延迟，防止动画事件未结束
					this.delayedFrames(() => {
						this.init(this.fileIndex[file.path]);
					}, 10)
					// console.log("重新初始化")
				} else {
					this.lastPosForChangeFile = [{ x: 0, y: 0, height: 0 }];
					this.events = {};
					this.uninit(0);

				}
			}));

			// this.registerEvent(this.app.workspace.on("active-leaf-change", (e) => {
			// 	console.log(e.)
			// }));

			// console.log("打开文件")

			this.init(0);
		});
	}

	onunload() {
		for (let i = 0; i < Object.keys(this.cursor).length; i++) {
			this.cursor[i]?.remove();
		}
		for (let i = 0; i < Object.keys(this.canvas).length; i++) {
			this.canvas[i]?.remove();
		}

		this.stopObserving();
		console.log("Smooth Cursor unloaded")
	}

	// 获取所有打开的 Markdown 页面路径
	getAllOpenFilePaths(): string[] {
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		const paths: string[] = [];

		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file) {
				paths.push(view.file.path);
			}
		}

		return paths;
	}

	isVimMode(): boolean {
		return document.querySelector('.cm-vimCursorLayer') !== null;
	}

	isVisible(elem: HTMLElement) {
		// 递归检查元素和所有父级是否都可见
		return !!(elem.offsetParent);
	}

	/**
	 * 监听事件 防止重复监听
	 */
	eventRegister<K extends keyof HTMLElementEventMap>(node: HTMLElement, key: K, func: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any) {
		let event = this.events[key];
		if (!event) {
			event = func as typeof this.events[typeof key];
			this.events[key] = event;
		}
		this.registerDomEvent(node, key, event as (this: HTMLElement, ev: HTMLElementEventMap[K]) => any);
	}

	uninit(i: number) {
		// console.log("反初始化");
		this.cursor[i]?.remove();
		this.canvas[i]?.remove();

		// console.log("移除光标和画布", this.cursor, this.cursor[i], i)

		this.isFirstTrail[i] = true;
		// this.cursor.splice(i, 1);
		// this.canvas.splice(i, 1);
		delete this.cursor[i];
		delete this.canvas[i];
		this.trailCount[i] = 0;

		this.stopObserving();
	}

	init(i: number) {
		// console.log("初始化")
		let ele = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf.view.containerEl.querySelector('.cm-editor') as HTMLElement;
		this.editorDom[i] = ele;
		this.test = ele.getBoundingClientRect();
		// let eles = document.querySelectorAll('.cm-editor');
		// for (let i = 0; i < eles.length; i++) {
		// 	let el = eles[i] as HTMLElement;
		// 	if (this.isVisible(el)) {
		// 		this.editorDom.push(el);
		// 		this.test = el.getBoundingClientRect();
		// 		break;
		// 	}
		// }

		if (!this.editorDom) {
			console.error("未打开文档");
			return;
		}

		// this.isInited = true;

		// 创建一个自定义光标
		// for (let i = 0; i < this.editorDom.length; i++) {
		// 	let cursor = this.app.workspace.containerEl.createDiv({ cls: "smooth-cursor-busyo" });
		// 	this.cursor.push(cursor);
		// 	cursor.id = "smooth-cursor-busyo-" + i;
		// 	this.editorDom[i].appendChild(cursor);

		// 	let vimText = this.app.workspace.containerEl.createDiv();
		// 	this.vimText.push(vimText);
		// 	cursor.appendChild(vimText);
		// 	vimText.classList.add("vim-text");
		// }

		let cursor = this.app.workspace.containerEl.createDiv({ cls: "smooth-cursor-busyo" });
		this.cursor[i] = cursor;
		cursor.id = "smooth-cursor-busyo-" + i;
		this.editorDom[i].appendChild(cursor);

		let vimText = this.app.workspace.containerEl.createDiv();
		this.vimText[i] = vimText;
		cursor.appendChild(vimText);
		vimText.classList.add("vim-text");

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


		if (!this.setting.enableTrail) {
			// for (let i = 0; i < this.cursor.length; i++) {
			// 	this.cursor[i].addClass("show");
			// }
			this.cursor[i]?.addClass("show");
		}

		// for (let i = 0; i < this.editorDom.length; i++) {


		// }

		this.createTrail(i);

		this.eventRegister(this.editorDom[i], "mousedown", (evt) => {

			this.isMouseDown = true;
			this.mouseForX.down = evt.clientX;
			this.mouseMoveTaget = { down: evt.target as HTMLElement, move: evt.target as HTMLElement };

			this.mouseForY.down = this.updateCursor(i)?.y || 0;
		});

		this.eventRegister(this.editorDom[i], "mousemove", (evt) => {
			if (this.isMouseDown) {
				this.mouseMoveTaget.move = evt.target as HTMLElement;

				this.mouseForX.move = evt.clientX;
				this.mouseForY.move = this.updateCursor(i)?.y || 0;
			}
		});

		this.eventRegister(this.editorDom[i], "mouseup", () => {

			this.isMouseDown = false;
			this.updateCursor(i);
		});


		this.eventRegister(this.editorDom[i], "keydown", (evt) => {
			// if (compositionStart && compositionUpdate) {
			// 	compositionStart = compositionUpdate = false;
			// 	return;
			// }
			let pos = this.updateCursor(i);
			// console.log("keydown => ", pos)

		});

		this.eventRegister(this.editorDom[i], "keyup", () => {
			// if (compositionEnd) {
			// 	compositionEnd = false;
			// 	return;
			// }
			let pos = this.updateCursor(i);
			// console.log("keyup => ", pos)
			// compositionEnd = true;
		});

		this.eventRegister(this.editorDom[i], "compositionstart", (evt) => {
			// compositionStart = true;
			let pos = this.updateCursor(i);
			// console.log("compositionupdate => ", pos)
		});

		this.eventRegister(this.editorDom[i], "compositionupdate", (evt) => {
			// compositionUpdate = true;
			let pos = this.updateCursor(i);
			// console.log("compositionupdate => ", pos)
		});

		this.eventRegister(this.editorDom[i], "compositionend", (evt) => {
			// compositionEnd = true;
			let pos = this.updateCursor(i);
			// console.log("compositionupdate => ", pos)
		});

		this.registerEvent(this.app.workspace.on("resize", () => {
			// this.isResize = true;
			if (this.canvas[i]) {
				this.canvas[i].width = window.innerWidth;
				this.canvas[i].height = window.innerHeight;
			}

			this.isScroll = true;
			this.updateCursor(i);
		}));

		// let scroller = document.querySelector('.cm-scroller');

		this.eventRegister(this.editorDom[i].querySelector(".cm-scroller") as HTMLElement, "scroll", () => {
			this.isScroll = true;
			this.updateCursor(i);
		});

		this.lastPos = this.lastPosForChangeFile;

		this.startObserving(i);

		//检测不在编辑器内
		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
			// console.log(leaf?.view.getViewType());
			if (leaf && leaf.view.containerEl.contains(this.editorDom[i])) {
				this.focus = true;
				document.body.addClass("caret-hide");
				this.cursor[i]?.addClass("show");
			} else {
				this.focus = false;
				document.body.removeClass("caret-hide");
				this.cursor[i]?.removeClass("show");
			}
		}));


		this.updateCursor(i);

		//默认隐藏系统光标
		document.body.addClass("caret-hide");

	}


	/**
	 * 更新光标坐标
	 */
	updateCursor(i: number) {
		if (!this.cursor[i] || !this.customStyle || this.curEditor != this.app.workspace.activeEditor) {
			this.curEditor = this.app.workspace.activeEditor;
			// console.log("未初始化或切换编辑器");
			return;
		}

		//判断点击的是文件名还是正文
		let selection = window.getSelection() as Selection;
		let node = selection.getRangeAt(0).commonAncestorContainer;
		let isTitle = false;
		if (node.nodeType === Node.ELEMENT_NODE) {
			// 尝试获取元素节点的右下角
			isTitle = (node as HTMLElement).classList.contains("inline-title");
		} else if (node.nodeType === Node.TEXT_NODE) {
			isTitle = (node.parentElement as HTMLElement).classList.contains("inline-title");
		}

		this.closeSettings = false;

		let pos = this.getCursorPosition(i, isTitle);

		// console.log("pos => ", pos)

		//如果返回的位置为无效位置，不更新光标
		if (pos.x == -1 && pos.y == -1) {
			this.focus = false;
			this.cursor[i]?.removeClass("show");
			return;
		} else {
			this.focus = true;
			this.cursor[i]?.addClass("show");
		}

		// console.log("坐标", pos)

		const scrollX = window.scrollX || document.documentElement.scrollLeft;
		const scrollY = window.scrollY || document.documentElement.scrollTop;

		if (this.isScroll) {
			this.cursor[i].addClass("noTrans");
		} else {
			this.cursor[i].removeClass("noTrans");
		}

		//vim 模式下方块光标文本更新
		if (this.isVimMode()) {
			let str = this.getNextCharAfterCursor(isTitle);
			if (str) {
				this.vimText && (this.vimText[i].textContent = str.text);
				this.vimStyle.textContent = (this.vimStyle.textContent as string).replace(/(--vim-font-size:\s*[^;]+;)/, `--vim-font-size: ${str.size};`);
			} else {
				this.vimText && (this.vimText[i].textContent = "");
			}
		} else {
			this.vimText && (this.vimText[i].textContent = "");
		}

		// 修改坐标，该部分样式为自动计算，仅用于坐标变化
		//change position, the style is automatically calculated and is used only for coordinate changes
		let content = (this.customStyle.textContent as string).replace(/(--cursor-x:\s*[^;]+;)/, `--cursor-x: ${pos.x + scrollX};`);
		content = content.replace(/(--cursor-y:\s*[^;]+;)/, `--cursor-y: ${pos.y + scrollY};`);
		content = content.replace(/(--cursor-height:\s*[^;]+;)/, `--cursor-height: ${pos.height};`);

		this.customStyle.textContent = content;

		if (this.setting.enableTrail && !this.isScroll) {
			if (this.lastPos[i] && (this.lastPos[i].x != pos.x || this.lastPos[i].y != pos.y)) {
				// console.log("更新轨迹")
				this.updateTrail(i, this.lastPos[i].x, this.lastPos[i].y, pos.x, pos.y, pos.height, this.lastPos[i].height);
			}
		}

		if (this.setting.enableTrail && this.cursor[i].hasClass("noAni")) {
			this.cursor[i].removeClass("noAni");
		} else if (!this.setting.enableTrail) {
			this.cursor[i].addClass("noAni");
			setTimeout(() => {
				this.cursor[i]?.removeClass("noAni");
			}, 80);
		}

		this.lastPos[i] = pos;
		if (this.editorDom[i].getBoundingClientRect().width !== 0) {

			this.lastPosForChangeFile[i] = pos;
		}
		// console.log("光标位置", pos)

		this.isScroll = false;

		return pos;
	}

	getNextCharAfterCursor(isTitle?: boolean) {
		if (isTitle) {
			return null;
		} else {
			const editor = this.app.workspace.activeEditor?.editor;
			const cmView = (editor as Editor & { cm: cmEditor })?.cm as cmEditorExtention; // CM6 的 EditorView 实例
			// console.log(cmView);
			if (cmView && editor) {
				const cursor = editor.getCursor();
				const doc = cmView.state.doc;
				const totalLines = doc.lines;

				if (cursor.line + 1 >= totalLines) {
					// console.log("已经是最后一行");
				} else {
					const nextLine = doc.line(cursor.line + 1);
					const safeCh = Math.min(cursor.ch, nextLine.length);
					const pos = nextLine.from + safeCh;

					if (pos < nextLine.to) {
						const char = doc.sliceString(pos, pos + 1);
						// console.log("字符是：", char);

						// 获取光标位置的 DOM 元素
						const coords = cmView.coordsAtPos(pos);
						if (coords) {
							// 获取光标所在的 DOM 元素
							const cursorNode = document.elementFromPoint(coords.left, coords.top);

							// 确保我们找到的是文本节点
							if (cursorNode) {
								// 获取该节点的字体大小
								const fontSize = window.getComputedStyle(cursorNode).fontSize;
								// console.log("当前字体大小是：", fontSize);

								return {
									text: char,
									size: fontSize // 返回字体大小作为数字
								};
							}
						}
					} else {
						// console.log("已经在该行末尾，不能再取字符");
						return null;
					}
				}
			}
		}
	}

	// 获取当前光标位置的函数
	getCursorPosition(i: number, isTitle?: boolean) {

		let editorDomRect = this.editorDom[i].getBoundingClientRect();

		if (isTitle) {
			//点击标题，cm 不更新，单独处理
			let selection = window.getSelection() as Selection;
			let range = selection.getRangeAt(0);
			let rect = range.getClientRects()[0];
			let dir = this.mouseForX.move <= this.mouseForX.down;

			return {
				x: rect.x + (dir ? 0 : rect.width) + window.scrollX - editorDomRect.x,
				y: rect.y + window.scrollY - editorDomRect.y,
				height: rect.height,
			}
		} else {
			//通过 cm 接口获取光标坐标
			const editor = this.app.workspace.activeEditor?.editor;
			const cmView = (editor as Editor & { cm: cmEditor })?.cm as cmEditorExtention; // CM6 的 EditorView 实例
			// console.log(cmView);
			if (cmView && editor) {
				const cursor = editor.getCursor();
				const offset = cmView.state.doc.line(cursor.line + 1).from + cursor.ch;
				let rect = cmView.coordsForChar(offset); // 获取 DOMRect
				if (!rect) {
					//判断是否表格
					let selection = window.getSelection() as Selection;
					let range = selection.getRangeAt(0);
					let node = range.commonAncestorContainer;
					let isTable = false;

					let tempNode: Node | null = node;

					while (tempNode) {
						if (tempNode.nodeType === Node.ELEMENT_NODE) {
							// 尝试获取元素节点的右下角
							isTable = Array.from((tempNode as HTMLElement).classList).some(cls => cls.includes("table"));
						} else if (tempNode.nodeType === Node.TEXT_NODE) {
							isTable = Array.from((tempNode.parentElement as HTMLElement).classList).some(cls => cls.includes("table"));
						}

						if (isTable) {
							break;
						} else {
							tempNode = tempNode.parentNode;
						}
					}

					if (isTable) {

						if ((!this.mouseMoveTaget || this.mouseMoveTaget.down.textContent === this.mouseMoveTaget.move.textContent)
							&& node.nodeType === Node.TEXT_NODE) {
							let dir = this.mouseForX.move <= this.mouseForX.down;
							const tempRange = document.createRange();
							tempRange.setStart(node, dir ? range.startOffset : range.endOffset);
							tempRange.setEnd(node, dir ? range.startOffset : range.endOffset);
							const rect = tempRange.getBoundingClientRect();
							return {
								x: rect.x + (dir ? 0 : rect.width) + window.scrollX - editorDomRect.x,
								y: rect.y + window.scrollY - editorDomRect.y,
								height: rect.height,
							}
						}

					} else {
						//行尾或者空行需要单独处理
						const domInfo = cmView.domAtPos(offset);
						node = domInfo.node;

						if (!node.parentElement?.classList.contains("cm-contentContainer")) {
							if (node.nodeType === Node.ELEMENT_NODE) {
								// 尝试获取元素节点的右下角
								const rects = (node as Element).getClientRects();
								if (rects.length > 0) {
									rect = rects[rects.length - 1]; // 返回最后一个可视矩形
								}
							} else if (node.nodeType === Node.TEXT_NODE) {
								const range = document.createRange();
								range.setStart(node, domInfo.offset);
								range.setEnd(node, domInfo.offset);
								const rt = range.getBoundingClientRect();
								if (rt.width || rt.height) rect = rt;
							}
						}
					}
				}

				if (rect) {
					return {
						x: rect.left + window.scrollX - editorDomRect.x,
						y: rect.top + window.scrollY - editorDomRect.y,
						height: rect.bottom - rect.top,
					};
				}
			}
		}

		return { x: -1, y: -1, height: 0 };  // 如果没有有效的选择，返回无效位置
	}

	startObserving(index: number) {
		// 获取 Obsidian 的 workspace 主体
		let root = document.querySelector('.cm-contentContainer');

		while (!root) {
			root = document.querySelector('.cm-contentContainer');
		}

		this.observer = new MutationObserver((mutations) => {
			let changed = false;

			for (const mutation of mutations) {
				if (mutation.type === 'childList') {

					for (let i = 0; i < mutation.addedNodes.length; i++) {
						if (mutation.addedNodes[i].nodeName != "BR" && !(mutation.addedNodes[i] as HTMLDivElement).classList?.contains("table-cell-wrapper")) {
							changed = true;
							break;
						}
					}

					for (let i = 0; i < mutation.removedNodes.length; i++) {
						if (mutation.removedNodes[i].nodeName != "BR" && !(mutation.removedNodes[i] as HTMLDivElement).classList?.contains("table-cell-wrapper")) {
							changed = true;
							break;
						}
					}
				}
			}

			if (changed) {
				this.delayedFrames(() => {
					this.updateCursor(index);
				});
			}
		});

		this.settingObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === 'childList') {

					for (let i = 0; i < mutation.addedNodes.length; i++) {
						if (mutation.addedNodes[i].nodeName == "DIV" && (mutation.addedNodes[i] as HTMLDivElement).classList?.contains("modal-container")) {
							// console.log("Obsidian 设置面板（模态框）已打开");
							this.focus = false;
							document.body.removeClass("caret-hide");
							this.cursor[index]?.removeClass("show");
							break;
						}
					}

					for (let i = 0; i < mutation.removedNodes.length; i++) {
						if (mutation.removedNodes[i].nodeName == "DIV" && (mutation.removedNodes[i] as HTMLDivElement).classList?.contains("modal-container")) {
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
		let self = this;

		const run = () => {
			frameCount++;

			if (frameCount === delay) {
				callback.call(self);
			} else {
				requestAnimationFrame(run);
			}
		};

		requestAnimationFrame(run);
	}

	/** 创建canvas */
	createTrail(i: number) {
		let self = this;
		// 创建拖尾画布

		this.canvas[i] = this.editorDom[i].createEl("canvas", { cls: "smooth-cursor-busyo-canvas" });
		this.canvas[i].id = "trail-canvas-" + i;

		const ctx = this.canvas[i].getContext("2d");

		this.canvas[i].width = this.editorDom[i].innerWidth;
		this.canvas[i].height = this.editorDom[i].innerHeight;

		// 绘制拖尾
		function drawTrail() {
			if (!self.canvas[i] || !self.rectangle[i] || ctx === null)
				return;

			if (self.cursor[i] && self.trailCount[i] != undefined && self.trailCount[i] <= 0) {
				ctx.clearRect(0, 0, self.canvas[i].width, self.canvas[i].height);
				self.focus && !self.closeSettings && self.cursor[i].addClass("show");
				return;
			}

			self.trailCount[i]--;

			let ratio = self.trailCount[i] / self.setting.trailStep;

			let targetX1 = self.rectangle[i].x - self.rectangle[i].dirX * 0.15 * Math.max(0, (-0.3 + ratio));
			let targetX2 = targetX1;

			let originX1 = self.rectangle[i].x - self.rectangle[i].dirX * ratio;
			let originX2 = originX1;

			if (self.rectangle[i].dirX === 3) {
				targetX1 = self.rectangle[i].x;
				targetX2 = targetX1;

				originX1 = self.rectangle[i].x - self.rectangle[i].dirX;
				originX2 = originX1;

			} else if (self.rectangle[i].dirY < 0) {
				targetX2 = self.rectangle[i].x - self.rectangle[i].dirX * 0.05 * Math.max(0, (-0.3 + ratio));
				originX1 = self.rectangle[i].x - self.rectangle[i].dirX * Math.max(0, (ratio - 0.02));
			} else if (self.rectangle[i].dirY > 0) {
				targetX1 = self.rectangle[i].x - self.rectangle[i].dirX * 0.05 * Math.max(0, (-0.3 + ratio));
				originX2 = self.rectangle[i].x - self.rectangle[i].dirX * Math.max(0, (ratio - 0.02));
			}

			let heightDiff = self.rectangle[i].extTarget - self.rectangle[i].extOrigin;

			ctx.clearRect(0, 0, self.canvas[i].width, self.canvas[i].height);

			ctx.beginPath();

			ctx.moveTo(targetX1, self.rectangle[i].y + self.rectangle[i].extTarget);
			ctx.lineTo(targetX2, self.rectangle[i].y);
			ctx.lineTo(originX1, self.rectangle[i].y - self.rectangle[i].dirY * ratio);
			ctx.lineTo(originX2, self.rectangle[i].y - self.rectangle[i].dirY * ratio + self.rectangle[i].extTarget - heightDiff * ratio);

			ctx.closePath();

			ctx.fillStyle = self.setting.trailColor; // 设置填充颜色
			ctx.fill(); // 填充形状
			// ctx.strokeStyle = "black"; // 设置描边颜色
			// ctx.stroke(); // 描边
		}

		// 动画循环
		function animate() {
			if (Object.keys(self.canvas).length === 0) {
				return;
			}
			drawTrail(); // 绘制拖尾
			requestAnimationFrame(animate); // 继续动画
		}

		animate(); // 启动动画循环
	}


	/**
	 * 更新拖尾坐标
	 */
	updateTrail(i: number, lastX: number, lastY: number, x: number, y: number, widthTarget: number, widthOrigin: number) {
		if (!this.cursor[i]) return;

		if (this.isFirstTrail[i]) {
			this.isFirstTrail[i] = false;
			this.cursor[i].addClass("show");
			return;
		}

		let dx = x - lastX;
		let dy = y - lastY;
		if (!this.rectangle[i]) {
			this.rectangle[i] = { x: 0, y: 0, dirX: 0, dirY: 0, extTarget: 0, extOrigin: 0 };
		}
		this.rectangle[i].x = x;
		this.rectangle[i].y = y;
		this.rectangle[i].dirX = dx == 0 ? 3 : dx;
		this.rectangle[i].dirY = dy;

		this.rectangle[i].extTarget = widthTarget;
		this.rectangle[i].extOrigin = widthOrigin;

		this.trailCount[i] = this.setting.trailStep;

		this.cursor[i].removeClass("show");
	}

	async loadSettings() {
		this.setting = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.setting);
	}

	updateSetting() {
		if (!this.cursor) return;
	}
}