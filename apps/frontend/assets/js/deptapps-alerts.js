window.DeptAppsAlerts = (function () {
    const self = this;
    self.alerts = [];

    self.removeAlert = function (alert) {
        self.alerts = self.alerts.filter(currentAlert => currentAlert.message !== alert.message);
        $(alert.__domElement).remove();
    };
    self.addAlert = function (alert) {
        if (!self.alerts.some(currentAlert => currentAlert.message === alert.message)) {
            self.alerts.push(alert);
            Object.defineProperty(alert, '__domElement', {
                value: $(`<div class="alert alert-${alert.type} alert-dismissible fade show" role="alert"><span>${alert.message}</span></div>`),
                enumerable: false,
                writable: false,
                configurable: false,
            });
            $(alert.__domElement).append($('<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>').click(function (event) {
                event.preventDefault();
                self.removeAlert(alert);
            }));
            if (!self.alertStatusBar) {
                self.alertStatusBar = $('.alerts-status-bar');
            }
            $(self.alertStatusBar).append(alert.__domElement);
            if (alert !== 'danger') {
                setTimeout(function () {
                    self.removeAlert(alert);
                }, 10000);
            }
        }
    };
    return {
        addAlert: self.addAlert,
    };
})();