import {RouteRecognizer} from 'aurelia-route-recognizer';
import {join} from 'aurelia-path';
import {NavigationContext} from './navigation-context';
import {NavigationInstruction} from './navigation-instruction';
import {RouterConfiguration} from './router-configuration';
import {processPotential} from './util';

export class Router {
  constructor(history) {
    this.history = history;
    this.viewPorts = {};
    this.reset();
    this.baseUrl = '';
  }

  registerViewPort(viewPort, name) {
    name = name || 'default';

    if (typeof this.viewPorts[name] == 'function') {
      var callback = this.viewPorts[name];
      this.viewPorts[name] = viewPort;
      this.configureRouterForViewPort(viewPort, callback);
    } else {
      this.configureRouterForViewPort(viewPort, () =>{
        if (typeof this.viewPorts[name] == 'function') {
          var callback = this.viewPorts[name];
          this.viewPorts[name] = viewPort;
          callback(viewPort);
        }else{
          this.viewPorts[name] = viewPort;
        }
      });
    }
  }

  configureRouterForViewPort(viewPort, callback){
    if('configureRouter' in viewPort.executionContext){
      var result = viewPort.executionContext.configureRouter() || Promise.resolve();
      result.then(() => callback(viewPort));
    }else{
      callback(viewPort);
    }
  }

  refreshBaseUrl() {
    if (this.parent) {
      var baseUrl = this.parent.currentInstruction.getBaseUrl();
      this.baseUrl = this.parent.baseUrl + baseUrl;
    }
  }

  refreshNavigation() {
    var nav = this.navigation;

    for(var i = 0, length = nav.length; i < length; i++) {
      var current = nav[i];

      if (this.baseUrl[0] == '/') {
        current.href = '#' + this.baseUrl;
      } else {
        current.href = '#/' + this.baseUrl;
      }

      if (current.href[current.href.length - 1] != '/') {
        current.href += '/';
      }

      current.href += current.relativeHref;
    }
  }

  configure(callbackOrConfig) {
    if (typeof callbackOrConfig == 'function') {
      var config = new RouterConfiguration();
      callbackOrConfig(config);
      config.exportToRouter(this);
    } else {
      callbackOrConfig.exportToRouter(this);
    }

    return this;
  }

  navigate(fragment, options) {
    fragment = join(this.baseUrl, fragment);
    return this.history.navigate(fragment, options);
  }

  navigateBack() {
    this.history.navigateBack();
  }

  createChild() {
    var childRouter = new Router(this.history);
    childRouter.parent = this;
    return childRouter;
  }

  createNavigationInstruction(url='', parentInstruction=null) {
    var results = this.recognizer.recognize(url);
    var fragment, queryIndex, queryString;

    if (!results || !results.length) {
      results = this.childRecognizer.recognize(url);
    }

    fragment = url
    queryIndex = fragment.indexOf("?");

    if (queryIndex != -1) {
      fragment = url.substr(0, queryIndex);
      queryString = url.substr(queryIndex + 1);
    }

    if((!results || !results.length) && this.catchAllHandler){
      results = [{
        config:{},
        handler:this.catchAllHandler,
        params:{
          path:fragment
        }
      }];
    }

    if (results && results.length) {
      var first = results[0],
          fragment = url,
          queryIndex = fragment.indexOf('?'),
          queryString;

      if (queryIndex != -1) {
        fragment = url.substr(0, queryIndex);
        queryString = url.substr(queryIndex + 1);
      }

      var instruction = new NavigationInstruction(
        fragment,
        queryString,
        first.params,
        first.queryParams,
        first.config || first.handler,
        parentInstruction
        );

      if (typeof first.handler == 'function') {
        return first.handler(instruction);
      }

      return Promise.resolve(instruction);
    } else {
      return Promise.reject(new Error(`Route Not Found: ${url}`));
    }
  }

  createNavigationContext(instruction) {
    return new NavigationContext(this, instruction);
  }

  generate(name, params) {
    return this.recognizer.generate(name, params);
  }

  addRoute(config, navModel={}) {
    if (!('viewPorts' in config)) {
      config.viewPorts = {
        'default': {
          moduleId: config.moduleId
        }
      };
    }

    navModel.title = navModel.title || config.title;

    this.routes.push(config);
    this.recognizer.add([{path:config.route, handler: config}]);

    if (config.route) {
      var withChild = JSON.parse(JSON.stringify(config));
      withChild.route += "/*childRoute";
      withChild.hasChildRouter = true;
      this.childRecognizer.add([{
        path: withChild.route,
        handler: withChild
      }]);

      withChild.navModel = navModel;
    }

    config.navModel = navModel;

    if (('nav' in config || 'order' in navModel) && this.navigation.indexOf(navModel) === -1) {
      navModel.order = navModel.order || config.nav;
      navModel.href = navModel.href || config.href;
      navModel.isActive = false;
      navModel.config = config;

      if (!config.href) {
        navModel.relativeHref = config.route;
        navModel.href = '';
      }

      if (typeof navModel.order != 'number') {
        navModel.order = ++this.fallbackOrder;
      }

      this.navigation.push(navModel);
      this.navigation = this.navigation.sort((a, b) => a.order - b.order);
    }
  }

  handleUnknownRoutes(config) {
    var callback = instruction => new Promise((resolve, reject) => {
      function done(inst){
        inst = inst || instruction;
        inst.config.route = inst.params.path;
        resolve(inst);
      }

      if (!config) {
        instruction.config.moduleId = instruction.fragment;
        done(instruction);
      } else if (typeof config == 'string') {
        instruction.config.moduleId = config;
        done(instruction);
      } else if (typeof config == 'function') {
        processPotential(config(instruction), done, reject);
      } else {
        instruction.config = config;
        done(instruction);
      }
    });

    this.catchAllHandler = callback;
  }

  reset() {
    this.fallbackOrder = 100;
    this.recognizer = new RouteRecognizer();
    this.childRecognizer = new RouteRecognizer();
    this.routes = [];
    this.isNavigating = false;
    this.navigation = [];
  }
}