let ModalProgressBar = function (key) {
  let modal = `
  <!-- Button trigger modal -->
  <button type="button" class="btn btn-primary launchModal${key} d-none" data-toggle="modal" data-target="#exampleModal${key}">
  </button>

  <!-- Modal -->
  <div class="modal" id="exampleModal${key}" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true" data-backdrop="static" data-keyboard="false">
    <div class="modal-dialog modal-dialog-centered">
      <div id="${key}"></div>
    </div>
  </div>
`;
  return modal;
};