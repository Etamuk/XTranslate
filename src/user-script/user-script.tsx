//-- User script app (page context)

import React from "react";
import { render } from "react-dom";
import { computed, observable, toJS, when } from "mobx";
import { observer } from "mobx-react";
import { debounce, isEqual } from "lodash"
import { autobind, cssNames, getHotkey } from "../utils";
import { getManifest, getStyles, MenuTranslateFavoritePayload, MenuTranslateVendorPayload, Message, MessageType, onMessage, PlayTextToSpeechPayload, sendMessage, TranslatePayload, TranslatePayloadResult } from "../extension";
import { getNextTranslator, ITranslationError, ITranslationResult } from "../vendors";
import { Icon } from "../components/icon";
import { XTranslateIcon } from "./xtranslate-icon";
import { ITranslateParams, Popup } from "../components/popup/popup";
import { settingsStore } from "../components/settings/settings.store";
import { themeStore } from "../components/theme-manager/theme.store";
import { userHistoryStore } from "../components/user-history/user-history.store";

const isPdf = document.contentType === "application/pdf";

interface Props {
  style: string;
}

@observer
class App extends React.Component<Props> {
  static rootElem = document.createElement("div");

  static async init() {
    App.rootElem.className = "XTranslate";
    document.documentElement.appendChild(App.rootElem);

    // render app inside the shadow-dom to avoid collisions with page styles
    var shadowRoot = App.rootElem.attachShadow({ mode: "open" });
    var style = await getStyles();
    await when(() => settingsStore.isLoaded && themeStore.isLoaded);
    render(<App style={style}/>, shadowRoot as any);
  }

  public appName = getManifest().name;
  private settings = settingsStore.data;
  private selection = window.getSelection();
  private popup: Popup;
  private icon: Icon;
  private lastParams: ITranslateParams;
  private isDblClicked = false;
  private isHotkeyActivated = false;
  private mousePos = { x: 0, y: 0, pageX: 0, pageY: 0 };

  @observable.ref translation: ITranslationResult;
  @observable.ref error: ITranslationError;
  @observable.ref selectionRects: ClientRect[];
  @observable position: Partial<ClientRect> = {};
  @observable selectedText = "";
  @observable isRtlSelection = false;
  @observable isIconShown = false;
  @observable isLoading = false;

  componentDidMount() {
    document.addEventListener("selectionchange", this.onSelectionChange);
    document.addEventListener("mousemove", this.onMouseMove, true);
    document.addEventListener("mousedown", this.onMouseDown, true);
    document.addEventListener("dblclick", this.onDoubleClick, true);
    document.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("resize", this.onResizeWindow);
    onMessage(this.onContextMenu);
    onMessage(this.onGetSelectedText);
  }

  @computed get isPopupHidden() {
    return !(this.translation || this.error);
  }

  @computed get iconPosition(): React.CSSProperties {
    var { selectedText, selectionRects, isRtlSelection, isIconShown } = this;
    if (!selectedText || !selectionRects || !isIconShown || !this.isPopupHidden) {
      return {
        display: "none"
      }
    }
    if (isRtlSelection) {
      var { left, top } = selectionRects[0];
      return {
        left: left,
        top: top,
        transform: isRtlSelection ? "translate(-100%, -100%)" : undefined,
      }
    }
    else {
      var { right, bottom } = selectionRects.slice(-1)[0];
      return {
        left: right,
        top: bottom,
      }
    }
  }

  translateLazy = debounce(this.translate, 250);

  @autobind()
  async translate(params?: Partial<ITranslateParams>) {
    var { vendor, langFrom, langTo, autoPlayText, historyEnabled } = this.settings;
    params = Object.assign({
      vendor: vendor,
      from: langFrom,
      to: langTo,
      text: this.selectedText,
    }, params);
    if (!params.text || isEqual(params, this.lastParams)) {
      return;
    }
    try {
      this.isLoading = true;
      this.lastParams = params as ITranslateParams;
      var translation = await this.translateProxy(params);
      if (params === this.lastParams) {
        this.translation = translation;
        this.error = null;
        if (autoPlayText) setTimeout(this.playText);
        if (historyEnabled) userHistoryStore.saveTranslation(this.translation);
      }
    } catch (err) {
      this.error = err;
    }
    this.isLoading = false;
    this.refreshPosition();
  }

  @autobind()
  translateNext(reverse = false) {
    if (!this.lastParams) return;
    var { vendor, from, to, text } = this.lastParams;
    var nextTranslator = getNextTranslator(vendor, from, to, reverse);
    return this.translate({
      vendor: nextTranslator.name,
      from, to, text,
    });
  }

  @autobind()
  async translateProxy(params: Partial<ITranslateParams>): Promise<ITranslationResult> {
    sendMessage<TranslatePayload>({
      type: MessageType.TRANSLATE_TEXT,
      payload: params as ITranslateParams,
    });
    return new Promise((resolve, reject) => {
      var stopListen = onMessage(({ type, payload }) => {
        if (type === MessageType.TRANSLATE_TEXT) {
          stopListen();
          if (isEqual(params, this.lastParams)) {
            var { data, error } = payload as TranslatePayloadResult;
            if (data) resolve(data);
            else reject(error);
          }
        }
      });
    });
  }

  @autobind()
  playText() {
    var { langDetected, langFrom, originalText, vendor } = this.translation;
    sendMessage<PlayTextToSpeechPayload>({
      type: MessageType.PLAY_TEXT_TO_SPEECH,
      payload: {
        vendor: vendor,
        lang: langDetected || langFrom,
        text: originalText
      }
    });
  }

  @autobind()
  stopPlaying() {
    sendMessage({
      type: MessageType.STOP_TTS_PLAYING
    });
  }

  showIcon() {
    this.isIconShown = true;
  }

  hideIcon() {
    this.isIconShown = false;
  }

  hidePopup() {
    if (this.isPopupHidden) return;
    this.translation = null;
    this.error = null;
    this.position = null;
    this.lastParams = null;
    this.selectionRects = null;
    this.isDblClicked = false;
    this.isHotkeyActivated = false;
    this.selection.removeAllRanges();
    this.stopPlaying();
  }

  isEditable(elem: Element) {
    return elem instanceof HTMLInputElement
      || elem instanceof HTMLTextAreaElement
      || (elem as HTMLElement).isContentEditable;
  }

  isOutside(elem: HTMLElement) {
    return !App.rootElem.contains(elem);
  }

  getViewportSize() {
    return {
      width: document.documentElement.clientWidth, // window.innerWidth + scrollbar
      height: document.documentElement.clientHeight, // window.innerHeight + scrollbar
    }
  }

  normalizeRect(rect: ClientRect, withScroll = true): ClientRect {
    var { left, top, width, height } = rect;
    if (withScroll) {
      left += window.pageXOffset;
      top += window.pageYOffset;
    }
    return {
      left, top, width, height,
      right: left + width,
      bottom: top + height,
    };
  }

  saveSelectionRects() {
    if (this.selection.rangeCount > 0) {
      var { anchorOffset, anchorNode, focusNode, focusOffset } = this.selection;
      var range = this.selection.getRangeAt(0);
      if (anchorNode !== focusNode) {
        var commonAncestorText = range.commonAncestorContainer.textContent;
        anchorOffset = commonAncestorText.indexOf(anchorNode.textContent);
        focusOffset = commonAncestorText.indexOf(focusNode.textContent);
      }
      var rects = Array.from(range.getClientRects());
      if (!rects.length) {
        if (this.isEditable(document.activeElement)) {
          rects.push(document.activeElement.getBoundingClientRect());
        }
        else if (focusNode === anchorNode && focusNode instanceof HTMLElement) {
          rects.push(focusNode.getBoundingClientRect());
        }
        else {
          rects.push(range.getBoundingClientRect());
        }
      }
      this.selectionRects = rects.map(rect => this.normalizeRect(rect));
      this.isRtlSelection = anchorOffset > focusOffset;
    }
    else if (this.selectionRects) {
      this.selectionRects = null;
      this.isRtlSelection = false;
    }
  }

  refreshPosition() {
    var { popupFixedPos } = this.settings;
    if (popupFixedPos || !this.selectionRects) return;
    var { top } = this.selectionRects[0];
    var { bottom } = this.selectionRects.slice(-1)[0];
    var left = Math.min(...this.selectionRects.map(({ left }) => left));
    var right = Math.max(...this.selectionRects.map(({ right }) => right));
    var viewPort = this.getViewportSize();

    // available position
    var positions: Partial<ClientRect>[] = [
      { left: left, top: bottom },
      { right: viewPort.width - right, bottom: -top }
    ];

    // apply first without viewport fitting check
    this.position = positions[0];

    // add initial position to the end in case of nothing will fit
    positions.slice(1).concat(positions[0])
      .forEach(({ left, right, top, bottom }) => {
        var popupPos = this.popup.elem.getBoundingClientRect();
        if (popupPos.left < 0 || popupPos.right > viewPort.width) {
          this.position.left = left;
          this.position.right = right;
        }
        if (popupPos.top < 0 || popupPos.bottom > viewPort.height) {
          this.position.top = top;
          this.position.bottom = bottom;
        }
      });
  }

  isClickedOnSelection() {
    if (!this.settings.showPopupOnClickBySelection) return;
    if (!this.selectedText || !this.selectionRects) return;
    var { pageX, pageY } = this.mousePos;
    return this.selectionRects.some(({ left, top, right, bottom }) => {
      return left <= pageX && pageX <= right && top <= pageY && pageY <= bottom;
    });
  }

  onSelectionChange = debounce(() => {
    this.selectedText = this.selection.toString().trim();

    if (this.isEditable(document.activeElement) || !this.selectedText) {
      return;
    }
    var { showPopupAfterSelection, showIconNearSelection, showPopupOnDoubleClick } = this.settings;
    if (showPopupAfterSelection) {
      this.saveSelectionRects();
      this.translateLazy();
    }
    else if (this.isPopupHidden) {
      this.saveSelectionRects();
      var showOnDoubleClick = showPopupOnDoubleClick && this.isDblClicked;
      if (showOnDoubleClick || this.isHotkeyActivated || this.isLoading) {
        this.translate();
      }
      else if (showIconNearSelection) {
        this.showIcon();
      }
    }
  }, 250);

  @autobind()
  onIconClick(evt: React.MouseEvent) {
    this.hideIcon();
    this.translate();
    evt.stopPropagation();
  }

  @autobind()
  onMouseMove({ clientX, clientY, pageX, pageY }: MouseEvent) {
    this.mousePos.x = clientX; // relative to viewport
    this.mousePos.y = clientY;
    this.mousePos.pageX = pageX; // with page scroll
    this.mousePos.pageY = pageY;
  }

  @autobind()
  onMouseDown(evt: MouseEvent) {
    var clickedElem = evt.target as HTMLElement;
    var rightBtnClick = evt.button === 2;
    if (rightBtnClick) {
      return;
    }
    if (!this.icon.elem.contains(clickedElem)) {
      this.hideIcon();
    }
    if (this.isOutside(clickedElem)) {
      if (this.isPopupHidden && this.isClickedOnSelection()) {
        this.translate();
        evt.preventDefault(); // don't reset selection
      }
      else {
        this.hidePopup();
      }
    }
  }

  @autobind()
  onDoubleClick(evt: MouseEvent) {
    if (this.settings.showPopupOnDoubleClick) {
      this.isDblClicked = true;
    }
  }

  @autobind()
  onContextMenu(message: Message) {
    var { type } = message;
    if (type === MessageType.MENU_TRANSLATE_WITH_VENDOR) {
      this.hideIcon();
      let { vendor, selectedText } = message.payload as MenuTranslateVendorPayload;
      this.translate({ vendor, text: selectedText });
    }
    if (type === MessageType.MENU_TRANSLATE_FAVORITE) {
      this.hideIcon();
      let { vendor, from, to, selectedText } = message.payload as MenuTranslateFavoritePayload;
      this.translate({ vendor, from, to, text: selectedText });
    }
  }

  @autobind()
  onGetSelectedText(message: Message) {
    if (!this.selectedText) return;
    if (message.type === MessageType.GET_SELECTED_TEXT) {
      sendMessage({
        type: MessageType.SELECTED_TEXT,
        payload: this.selectedText,
      })
    }
  }

  @autobind()
  onKeyDown(evt: KeyboardEvent) {
    if (!this.isPopupHidden) {
      switch (evt.code) {
        case "Escape":
          this.hidePopup();
          evt.stopPropagation();
          break;
        case "ArrowLeft":
          this.translateNext(true);
          evt.stopImmediatePropagation();
          evt.preventDefault();
          break;
        case "ArrowRight":
          this.translateNext();
          evt.stopImmediatePropagation();
          evt.preventDefault();
          break;
      }
    }
    // handle text translation by hotkey
    if (!this.settings.showPopupOnHotkey) {
      return;
    }
    var hotkey = getHotkey(evt);
    var { keyCode, ...currentHotkey } = toJS(this.settings.hotkey);
    if (isEqual(currentHotkey, hotkey) && this.isPopupHidden) {
      evt.preventDefault();
      this.isHotkeyActivated = true;

      var text = this.selectedText;
      var mouseTarget = document.elementFromPoint(this.mousePos.x, this.mousePos.y) as HTMLElement;
      var notRoot = mouseTarget !== document.documentElement && mouseTarget !== document.body;
      var autoSelectText = !text && notRoot && this.isOutside(mouseTarget);
      if (autoSelectText) {
        if (["input", "textarea", "img"].includes(mouseTarget.nodeName.toLowerCase())) {
          if (mouseTarget instanceof HTMLInputElement || mouseTarget instanceof HTMLTextAreaElement) {
            text = mouseTarget.value || mouseTarget.placeholder;
          }
          if (mouseTarget instanceof HTMLImageElement) {
            text = mouseTarget.title || mouseTarget.alt;
          }
          if (text) {
            this.selectionRects = [this.normalizeRect(mouseTarget.getBoundingClientRect())];
          }
        }
        else {
          mouseTarget.style.userSelect = "auto"; // make sure selection is not blocked from css
          this.selection.selectAllChildren(mouseTarget);
          this.saveSelectionRects();
          text = this.selection.toString().trim();
          mouseTarget.style.userSelect = null;
        }
      }
      if (text) {
        this.translate({ text });
      }
    }
  }

  onResizeWindow = debounce(() => {
    if (!this.isPopupHidden) this.saveSelectionRects();
    this.refreshPosition();
  }, 250)

  render() {
    var { translation, error, playText, translateNext, position, onIconClick, lastParams } = this;
    var { langFrom, langTo } = this.settings;
    return (
      <>
        <Popup
          className={cssNames({ showInPdf: isPdf })}
          style={position}
          params={lastParams}
          translation={translation} error={error}
          onPlayText={playText}
          onTranslateNext={() => translateNext()}
          ref={e => this.popup = e}
        />
        <XTranslateIcon
          style={this.iconPosition}
          onMouseDown={onIconClick}
          title={`${this.appName}: ${[langFrom, langTo].join(' → ').toUpperCase()}`}
          bindRef={e => this.icon = e}
        />
        <style type="text/css">
          {this.props.style}
        </style>
      </>
    )
  }
}

// init
App.init();
