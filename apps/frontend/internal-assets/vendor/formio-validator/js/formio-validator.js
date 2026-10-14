;;
let dataValidator = async function (self, element, component) {
    if ($('.formbuilder') && $('.formbuilder').length === 0 && self.component.messages.length > 0) {

        let res = await changePropertieControlErrorsFormio(true);

        return new Promise((resolve, reject) => {
            $.post({
                url: "component/formio/log",
                data: {
                    messages: {
                        error: self.component.messages
                    },
                    component,
                    key: self.component.key
                },
            }).then(() => {
                resolve(200);
                reject("Ha ocurrido un error con la petición al servidor");
            });
        })
    } else {
        let res = await changePropertieControlErrorsFormio(false);
        return new Promise((resolve, reject) => {
            resolve(400);
            reject("Ha ocurrido un error con la petición al servidor");
        })
    }
};

let changePropertieControlErrorsFormio = async function (action) {
    $.post({
        url: "component/formio/controlerrors",
        data: {
            action
        }
    }).then(data => {
        return data;
    })
}
    ;;