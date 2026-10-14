
(function () {
  Formio.icons = 'fontawesome';

  const ctx = typeof window === "undefined" ? global : window;

  const BASE_RESOURCE_URI = '/dsapp-c1a96f51.0328b/api';
  const TRY_TO_ESTABLISH_WEB_SOCKET_INTERVAL_IN_SECONDS = 5;
  const TRY_TO_ESTABLISH_WEB_SOCKET_INTERVAL_MS = TRY_TO_ESTABLISH_WEB_SOCKET_INTERVAL_IN_SECONDS * 1000;
  const LOCAL_URLS = ["localhost", "127.0.0.1"];
  const EMEAL_CLOUD_URLS = ["deptapps.everis.cloud"];

  const TYPE_NODE_SECTION = 'section';
  const TYPE_NODE_FORM = 'form';

  $.ajaxSetup({
    beforeSend: function (xhr) {
      const csrfTokenMetaHtmlElement = document.querySelector('meta[name="csrf-token"]');
      if (csrfTokenMetaHtmlElement) {
        xhr.setRequestHeader('CSRF-Token', csrfTokenMetaHtmlElement.getAttribute('content'));
      }
    }
  });

  ctx.DeptAppService = (function () {
    function returnToHome() {
      const baseUrl = ctx.location.protocol + "//" + ctx.location.host + "/" + ctx.location.pathname.split('/')[1];
      ctx.location = baseUrl;
    }

    return {
      getMenuStructure: function () {
        return new Promise(function (resolve, reject) {
          $.ajax({
            method: 'GET',
            url: BASE_RESOURCE_URI + '/menu/structure',
            success: function (data) {
              resolve(data);
            },
            statusCode: {
              401: function () {
                returnToHome();
              },
            },
            error: function () {
              reject(...arguments);
            }
          });
        });
      },
      getFormListInfo: function () {
        return new Promise(function (resolve, reject) {
          $.ajax({
            method: 'GET',
            url: BASE_RESOURCE_URI + '/forms/list',
            success: function (data) {
              resolve(data);
            },
            statusCode: {
              401: function () {
                returnToHome();
              },
            },
            error: function () {
              reject(...arguments);
            }
          });
        });
      },
      getFormInfo: function (form) {
        return new Promise(function (resolve, reject) {
          $.ajax({
            method: 'GET',
            url: form.infoResourceUri,
            success: function (data) {
              resolve(data);
            },
            error: function () {
              reject(...arguments);
            }
          });
        });
      },
      getFormStructure: function (form, opts) {
        return new Promise(function (resolve, reject) {
          $.ajax({
            method: 'POST',
            url: form.formStructureResourceUri,
            contentType: "application/json",
            dataType: 'json',
            data: JSON.stringify(opts || {}),
            success: function (data) {
              resolve(data);
            },
            statusCode: {
              401: function () {
                returnToHome();
              },
            },
            error: function () {
              reject(...arguments);
            }
          });
        });
      },
      sendSubmission: function (form, submission, opts) {
        opts = opts || {};
        return new Promise(function (resolve, reject) {
          $.ajax({
            url: !!opts.__onInitForm ? form.onInitFormResourceUri : form.formSubmitResourceUri,
            method: 'POST',
            dataType: 'json',
            contentType: 'application/json',
            data: JSON.stringify(submission || {}),
            success: function (data) {
              resolve(data);
            },
            statusCode: {
              401: function () {
                returnToHome();
              },
            },
            error: function () {
              reject(...arguments);
            }
          });
        });
      },


      getUserInfo: function () {
        return new Promise(function (resolve, reject) {
          $.ajax({
            method: 'GET',
            url: BASE_RESOURCE_URI + '/user/info',
            success: function (data) {
              resolve(data);
            },
            statusCode: {
              401: function () {
                returnToHome();
              },
            },
            error: function () {
              reject(...arguments);
            }
          });
        });
      },

    };
  })();

  ctx.DeptApps = (function () {
    const self = this;
  
    self.addAlert = DeptAppsAlerts.addAlert;
    self.downloadFileIfNeeded = function(response, opts) {
      opts = opts || {};
      try {
        if (!opts.webSocketRefresh && !_.isEmpty(response.downloadFileSubmission) && !_.isEmpty(response.downloadFileSubmission.fileName) && !_.isEmpty(response.downloadFileSubmission.file) && 
          !_.isNil(response.downloadFileSubmission.file.data)) {
          const { downloadFileSubmission } = response;
          setTimeout(function() {
            const link = document.createElement('a');
            const bytes = new Uint8Array(downloadFileSubmission.file.data); 
            const blob = new Blob([bytes]);
            link.download = downloadFileSubmission.fileName;
            link.href = window.URL.createObjectURL(blob);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          });
        }
      } catch (e)  {
        console.warn(e);
      } finally {
        delete response.downloadFileSubmission;
      }
    };
    self.__internalHandleServerResponse = function (form, submission, error, response, opts) {
      opts = opts || {};
      let alert, isActionTypeUpdate, formRefreshOrUpdate, initPopulateFormStructure, initSubmission;
      try {
        if (_.isNil(error)) {
          // view-action node: download-file
          self.downloadFileIfNeeded(response, opts);
          // try (Handle submit)
          if ((isActionTypeUpdate = response.action === 'update')) {
            formRefreshOrUpdate = form;
            initSubmission = response.submission || {};
            if (!!opts.isActionTypeUpdate || (!!opts.handleMenuClickForm && !opts.__onInitForm)) {
              if (!_.isEmpty(response.alertMessage)) {
                alert = { type: response.alertMessage.type, message: response.alertMessage.message };
              } else if (!opts.webSocketRefresh) {
                alert = { type: 'info', message: 'The data has been processed and received correctly by the server' };
              }
            }
          } else if (response.action === 'redirect') {
            formRefreshOrUpdate = self.forms.find(form => form.id === response.page);

            initSubmission = response.onInitSubmission || {};
          }
          initPopulateFormStructure = response.onInitPopulateFormStructure || {};
        } else {
          // catch
          let message;
          if (error.status !== 0) {
            if (error.status === 406 || error.status === 503) {
              message = error.responseText;
            }
            if (_.isEmpty(message)) {
              message = 'An unexpected error occurred while handling the request on the server';
            }
          } else {
            message = 'The server is no longer accessible. Sorry for the inconvenience';
          }
          alert = { type: 'danger', message: message };
          formRefreshOrUpdate = form;
          initSubmission = submission.data || {};
          isActionTypeUpdate = true;
          throw error;
        }
      } finally {
        if (_.isEmpty(formRefreshOrUpdate)) {
          let warningMessageDetails;
          if (!!isActionTypeUpdate) {
            warningMessageDetails = 'corrupt or non-processed information in order to update current form';
          } else {
            warningMessageDetails = 'an unknown form in oder to redirect this one';
          }
          self.addAlert({ type: 'warning', message: `The server response contains ${warningMessageDetails}! Please contact with the webmaster!` });
        } else {
          self.refreshSinglePageApplication(formRefreshOrUpdate, {
            initSubmission: initSubmission,
            initPopulateFormStructure: initPopulateFormStructure || {},
            isActionTypeUpdate: isActionTypeUpdate
          });
        }
        if (!_.isNil(alert)) {
          setTimeout(() => {
            self.addAlert(alert);
          });
        }
      }
    };

    self.webSocketSubscriptions = (function() {
      const subscriptions = {};
      return {
        subscribe: (topic, fn) => {
          if (_.isString(topic) && !_.isEmpty(topic) && _.isFunction(fn)) {
            (subscriptions[topic] = subscriptions[topic] || []).push(fn);
          }
        }, 
        unsubscribe: (topic, fn) => {
          _.remove((subscriptions[topic] = subscriptions[topic] || []), current => current === fn);
        },
        next: (topic, data) => {
          (subscriptions[topic] = subscriptions[topic] || []).forEach(fn => fn(topic, data));
        }
      }
    })();

    self.attachWebSocket = function (opts) {
      opts = opts || {};
      const { location } = ctx;
      const isLocal = LOCAL_URLS.some(p => location.host.includes(p));
      const isEmeal = EMEAL_CLOUD_URLS.some(p => location.host.includes(p));
      const localOrEmeal =  isLocal || isEmeal;
      try {
        const parts = location.pathname.split('/');
        const wssPrefix = `ws${location.protocol === 'https:' ? 's' : ''}://`;
        let wsPath;

        if (localOrEmeal) {
            const pathname = parts[1] != 'index.html' ? parts[1] : parts[0];
            wsPath = `${wssPrefix}/${location.host}/${!!pathname ? pathname+'/wss': 'wss'}`;
        } else {
            const pathname = parts.slice(0, 2).filter(Boolean).join('/');
            const app = parts[3];
            wsPath = `${wssPrefix}/${location.host}/${pathname}/wss?app=${app}`;
        }

        self.webSocketClient = new WebSocket(wsPath);
        self.webSocketClient.onopen = function() {
          if (opts.fallback) {
            self.addAlert({
              type: 'info',
              message: `The connection with the server has been restored successfully!`
            });
          }
        }
        self.webSocketClient.onmessage = function (event) {
          try {
            let messages = JSON.parse(event.data);
            if (!_.isArray(messages)) {
              messages = [messages];
            }
            for (const { topic, data } of messages) {
              if (!_.isString(topic) || _.isEmpty(topic)) {
                console.warn('[deptapp-app-websocket-client] message without topic', currentMessage);
              } else {
                self.webSocketSubscriptions.next(topic, data);
              }
            }
          } catch (e) {
            console.warn(e);
          }
        };
        self.webSocketClient.onclose = function () {
          self.addAlert({
            type: 'warning',
            message: `The connection with the server has been lost! Retry connect again in ${TRY_TO_ESTABLISH_WEB_SOCKET_INTERVAL_IN_SECONDS} seconds...`
          });
          setTimeout(() => {
            self.attachWebSocket({ fallback: true });
          }, TRY_TO_ESTABLISH_WEB_SOCKET_INTERVAL_MS);
        }
      } catch (e) {
        console.warn(e);
      }
    };
  
    self.attachEventFormioButtons = function (form) {
      $('.formio-component-button > button', $(form.__formioViewerDomElement)).click(function (event) {
        const buttonClicked = $(event.currentTarget || event.target);
        const nameButtonClicked = buttonClicked.attr('name');
        const groupsMatched = nameButtonClicked.match(/\[([^\]]+)\]/g).map(element => element.substring(1, element.length - 1));
  
        form.__lastTriggeredButton = groupsMatched[groupsMatched.length - 1];
      });
    };
    self.triggerOnDocumentReadyButtonActionIfNeeded = function (form, opts) {
      opts = opts || {};
      if (_.isEmpty(form.onDocumentReadyButtonAction)) {
        if (_.isFunction(opts.notTriggeredCallback)) {
          opts.notTriggeredCallback();
        }
      } else if (_.isNil(form.__lastTriggeredButton) || form.onDocumentReadyButtonAction !== form.__lastTriggeredButton) {
        setTimeout(function () {
          $('.formio-component-' + form.onDocumentReadyButtonAction + ' button').click();
          if (_.isFunction(opts.next)) {
            opts.next();
          }
        }, 0);
      }
    };
  
    self.sendSubmissionAndHandleServerResponse = async function (form, submission, opts) {
      opts = opts || {};
      let error, response;
      try {
        response = await DeptAppService.sendSubmission(form, submission, opts);
      } catch (e) {
        error = e;
      } finally {
        self.__internalHandleServerResponse(form, submission, error, response, opts);
      }
    };
    self.refreshSinglePageApplication = async function (form, opts) {
      opts = _.cloneDeep(opts || {});

      self.__currentForm = form;
      //XXX: Always get form-structure before render form, because is neccesary prepopulate dropdowns with relationships!
      form.__formStructure = await DeptAppService.getFormStructure(form, opts);
      //XXX: Always refresh info form, because need updated value of 'onInitFormResourceUri' property
      const formInfoUpdated = await DeptAppService.getFormInfo(form);
      _.assign(form, formInfoUpdated);
  
      const __oldFormioViewerDomElement = form.__formioViewerDomElement;
      form.__formioViewerDomElement = $('<div class="h-100"></div>')[0];
      form.__lastTriggeredButton = undefined;
  
      const formioViewer = form.__formioViewer = await Formio.createForm(form.__formioViewerDomElement, form.__formStructure, { noAlerts: true });
      // Prevent the submission from going to the form.io server.
      formioViewer.nosubmit = true;
  
      if (!_.isNil(__oldFormioViewerDomElement)) {
        $(__oldFormioViewerDomElement).remove();
      }
      $(self.pagePartialDivElement).empty();
      $(self.pagePartialDivElement).append(form.__formioViewerDomElement);
  
      self.attachEventFormioButtons(form);
  
      // If initSubmission, populate fields forms with this one!
      let finalFormioViewerSubmission;
      if (!_.isNil(opts.initSubmission) && _.isObject(opts.initSubmission) && !_.isEmpty(opts.initSubmission)) {
        formioViewer.submission = finalFormioViewerSubmission = { data: opts.initSubmission || {} };
      } else {
        finalFormioViewerSubmission = formioViewer.submission;
      }
      if (!opts.isActionTypeUpdate) {
        self.triggerOnDocumentReadyButtonActionIfNeeded(form, {
          notTriggeredCallback: () => {
            if (_.isBoolean(form.isOnInitFormOutputConnected) && !!form.isOnInitFormOutputConnected) {
              self.sendSubmissionAndHandleServerResponse(form, finalFormioViewerSubmission || {}, _.defaults({ __onInitForm: true }, opts));
            }
          }
        });
      }
      // Triggered when they click the submit button.
      formioViewer.on('submit', async function (submission) {
        self.sendSubmissionAndHandleServerResponse(form, submission || {}, opts);
      });
    };
    self.handleDefaultClickDashboardMenuItem = function (welcomePageDomElement) {
      $(welcomePageDomElement).on('click', function (e) {
        e.preventDefault();
        self.__currentForm = undefined;
        self.pagePartialDivElement.empty();
        $(self.pagePartialDivElement).append(self.dashboardPartialElements);
        if (!$(self.dashboardPartialElements).is(':visible')) {
          self.dashboardPartialElements.show();
        }
      });
    };
    self.handleClickDashboardMenuItem = function () {
      self.dashboardPartialElements = $(self.pagePartialDivElement).children();
      //Custom Welcome Page
      const welcomePageDomElement = $('.dashboard-link').eq(0);
      if (!_.isEmpty(self.welcomePage)) {
        const form = self.forms.find(currentForm => currentForm.id === self.welcomePage);
        if (!_.isNil(form)) {
          form.__domElement = $(welcomePageDomElement);
          self.handleMenuClickForm(form);

        } else {
          self.addAlert({
            type: 'warning',
            message: "The form with id'" + self.welcomePage + "' does not exist between the flows of your application. Reconfigure welcome page app!"
          });
          self.handleDefaultClickDashboardMenuItem(welcomePageDomElement);
        }
      } else {
        self.handleDefaultClickDashboardMenuItem(welcomePageDomElement);
      }
      $(welcomePageDomElement).trigger('click');
    };
    self.handleMenuClickForm = function (form) {
      $(form.__domElement).on('click', function (e) {
        e.preventDefault();
        self.refreshSinglePageApplication(form, { handleMenuClickForm: true });
      });
    };

    self.addWarningAlertWhenFormNotExists = function (formTreeData) {
      console.warn("The form '" + formTreeData.text + "' (" + formTreeData.data.form_id + ") not exists!");
      self.addAlert({
        type: 'warning',
        message: "The form '" + formTreeData.text + "' does not exist between the flows of your application. Reconfigure menu app!"
      });
    };
    self.printSection = function (sectionTreeData) {
      const sectionDomElement = $('<li class="nav-item dropdown">' +
        '<a class="nav-link dropdown-toggle" href="#" role="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">' +
        '<i class="fas fa-fw fa-folder"></i>&nbsp;&nbsp;' +
        '<span>' + sectionTreeData.text + '</span>' +
        '</a>' +
        '<div class="dropdown-menu">' +
        '</div>' +
        '</li>');
      const dropDownMenu = $(sectionDomElement).find('.dropdown-menu');
      (sectionTreeData.children || []).forEach(formTreeData => {
        const form = self.forms.find(currentForm => currentForm.id === formTreeData.data.form_id);
        if (!_.isNil(form)) {
          form.__domElement = $(`<a class="dropdown-item" href="javascript:void(0);">${!_.isEmpty(formTreeData.data.form_name) ? formTreeData.data.form_name : form.name}</a>`);
          dropDownMenu.append(form.__domElement);
          self.handleMenuClickForm(form);

        } else {
          self.addWarningAlertWhenFormNotExists(formTreeData);
        }
      });
      self.sidebar.append(sectionDomElement);
    };
    self.printViewFormAsASection = function (formTreeData) {
      const form = self.forms.find(currentForm => currentForm.id === formTreeData.data.form_id);
      if (!_.isNil(form)) {
        const formAsASectionDomElement = $('<li class="nav-item"></li>');
        form.__domElement = $(`<a class="nav-link" href="javascript:void(0)"><i class="fas fa-fw fa-desktop"></i><span>&nbsp;&nbsp;${!_.isEmpty(formTreeData.data.form_name) ? formTreeData.data.form_name : form.name}</span></a>`);
        formAsASectionDomElement.append(form.__domElement);
        self.handleMenuClickForm(form);
        self.sidebar.append(formAsASectionDomElement);

      } else {
        self.addWarningAlertWhenFormNotExists(formTreeData);
      }
    };
    self.printMenu = function () {
      if (self && self.menuStructure && self.menuStructure.length > 0 && self.menuStructure[0] && self.menuStructure[0].children) {
        self.menuStructure[0].children.forEach(childrenTreeData => {
          if (childrenTreeData.type === TYPE_NODE_SECTION) {
            self.printSection(childrenTreeData);
          } else if (childrenTreeData.type === TYPE_NODE_FORM) {
            self.printViewFormAsASection(childrenTreeData);
          }
        });
      }
    };

  
        self.printUserData = function() {
          $('#userDropdown').append($('<span>&nbsp;' + self.userInfo.userName + '</span><br /><span>&nbsp;(' + self.userInfo.axetProject.displayName + ')</span>'));
        };


      $(async function () {
        try {
          self.attachWebSocket();
          self.pagePartialDivElement = $('div[aria-deptapps-element-type="partial"]');
          self.sidebar = $('ul.sidebar.navbar-nav');
  
          self.forms = await DeptAppService.getFormListInfo();
          const { menuStructure, welcomePage } = await DeptAppService.getMenuStructure();
          self.menuStructure = menuStructure;
          self.welcomePage = welcomePage;


          self.userInfo = await DeptAppService.getUserInfo();
          self.printUserData();

          self.handleClickDashboardMenuItem();
          self.printMenu();

          self.webSocketSubscriptions.subscribe('/submission', (__, data) => {
            const { page } = data;
            // delete data.page;
            let isResponseActionRedirect = data.action === 'redirect';
            if (!self.__currentForm) {
              // Welcome page, only handle alert message
              if (isResponseActionRedirect) {
                self.__internalHandleServerResponse(undefined, undefined, undefined, data, { isActionTypeUpdate: !isResponseActionRedirect, webSocketRefresh: true });
              } else if (_.isEmpty(page) && !_.isEmpty(data.alertMessage)) {
                self.addAlert({ type: data.alertMessage.type, message: data.alertMessage.message });  
              }  
            } else if (isResponseActionRedirect || _.isEmpty(page) || self.__currentForm.id === page) {
              const formSubmission = self.__currentForm.__formioViewer ? self.__currentForm.__formioViewer.submission || {} : {};
              data.submission = data.submission || {};
              _.defaultsDeep(data.submission, formSubmission.data);
              self.__internalHandleServerResponse(self.__currentForm, formSubmission, undefined, data, { isActionTypeUpdate: !isResponseActionRedirect, webSocketRefresh: true });
            }            
          });
        } catch (e) {
          self.addAlert({
            type: 'danger',
            message: 'An unexpected error occurred while loading the application menu'
          });
          throw e;
        }
      });
    return {};
  })();
})();


