//-- Main window app (options page)
import './app.scss'

import * as React from 'react';
import { render } from 'react-dom'
import { reaction, when } from "mobx";
import { observer } from "mobx-react";
import { cssNames } from "../../utils/cssNames";
import { __i18n, getManifest, getOptionsPageUrl } from "../../extension";
import { Settings } from '../settings'
import { settingsStore } from '../settings/settings.store'
import { themeStore } from "../theme-manager/theme.store";
import { Footer } from '../footer'
import { Spinner } from "../spinner";
import { Tab, Tabs } from "../tabs";
import { ThemeManager } from "../theme-manager";
import { InputTranslation } from "../input-translation";
import { UserHistory } from "../user-history";
import { AppRoute } from "./app.route";
import { Icon } from "../icon";
import { Store } from "../../store";
import { AppRateDialog } from "./app-rate.dialog";

@observer
export class App extends React.Component {
  static rootElem = document.getElementById('app');

  public manifest = getManifest();
  public settings = settingsStore.data;

  static async init() {
    Store.defaultParams.autoSave = true; // enable default auto-saving only to options page
    render(<Spinner center/>, App.rootElem); // show loading indicator
    await when(() => settingsStore.isLoaded && themeStore.isLoaded);
    render(<App/>, App.rootElem);
  }

  componentDidMount() {
    this.setUpTheme();
    reaction(() => this.settings.useDarkTheme, this.setUpTheme);
    document.title = this.manifest.name;
    window.addEventListener("hashchange", () => this.forceUpdate());
  }

  setUpTheme = () => {
    document.body.classList.toggle('theme-dark', this.settings.useDarkTheme);
  }

  detachWindow = () => {
    chrome.windows.create({
      url: getOptionsPageUrl(),
      focused: true,
      width: 570,
      height: 650,
      type: "popup"
    });
  }

  onTabsChange = (location: string) => {
    document.location.href = location;
    window.scrollTo(0, 0);
  }

  render() {
    var { name, version } = this.manifest;
    var { useDarkTheme } = this.settings;
    var activePageId = location.hash || AppRoute.settings;
    return (
      <div className="App">
        <header className="flex gaps">
          <div className="app-title box grow">
            {name} <sup className="app-version">{version}</sup>
          </div>
          <Icon
            svg="moon"
            title={__i18n("use_dark_theme")}
            className={cssNames("dark-theme-icon", { active: useDarkTheme })}
            onClick={() => this.settings.useDarkTheme = !useDarkTheme}
          />
          <Icon
            material="open_in_new"
            title={__i18n("open_in_window")}
            onClick={this.detachWindow}
          />
        </header>
        <Tabs center value={activePageId} onChange={this.onTabsChange}>
          <Tab value={AppRoute.settings} label={__i18n("tab_settings")} icon="settings"/>
          <Tab value={AppRoute.theme} label={__i18n("tab_theme")} icon="color_lens"/>
          <Tab value={AppRoute.popup} label={__i18n("tab_text_input")} icon="translate"/>
          <Tab value={AppRoute.history} label={__i18n("tab_history")} icon="history"/>
        </Tabs>
        <div className="tab-content">
          {activePageId === AppRoute.settings && <Settings/>}
          {activePageId === AppRoute.theme && <ThemeManager/>}
          {activePageId === AppRoute.popup && <InputTranslation/>}
          {activePageId === AppRoute.history && <UserHistory/>}
        </div>
        <Footer/>
        <AppRateDialog/>
      </div>
    );
  }
}

// init app
App.init();