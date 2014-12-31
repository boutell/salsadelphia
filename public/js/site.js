$(function() {

  $('body').on('click', '[data-confirm]', function() {
    return confirm('Are you sure?');
  });

  var $form = $('form.new-event');
  $form.find('[name="venue"]').autocomplete({
    source: '/autocomplete-venue',
    minlength: 1,
    select: function(event, ui) {
      $form.find('[name="address"]').val(ui.item.address);
    }
  });

  // What I really wanted here was a conventional named submit button,
  // but since we're hating those for CSS reasons, let's simulate one
  $form.find('.remove').click(function() {
    if (!confirm("Are you sure this listing should be removed?")) {
      return false;
    }
    $form.append($('<input type="hidden" name="remove" value="1" />'));
    $form.submit();
    return false;
  });

  // What I really wanted here was a conventional named submit button,
  // but since we're hating those for CSS reasons, let's simulate one
  $form.find('.reject').click(function() {
    $form.append($('<input type="hidden" name="reject" value="1" />'));
    $form.submit();
    return false;
  });

  $form.find('.save').click(function() {
    var required = [
      'name',
      'venue',
      'address',
      'date',
      'time'
    ];
    var $form = $(this).closest('form');
    var i;
    for (i = 0; (i < required.length); i++) {
      var $field = $form.find('[name="' + required[i] + '"]');
      var val = $field.val();
      if (!val) {
        alert(required[i] + ' is required.');
        $field.focus();
        return false;
      }
    }
    $form.submit();
    return false;
  });

  $form.find('[name="repeat"]').on('change', ifRepeatShowCalendar);
  $form.find('[name="repeat"]').on('change', ifDatesChange);

  $form.find('th[data-weekday]').on('click', function() {
    var weekday = $(this).attr('data-weekday');
    $form.find('input[data-weekday="' + weekday + '"]').trigger('click');
    ifDatesChange();
    return false;
  });

  $('.repeat-calendar input').on('click', ifDatesChange);

  var $repeat = $('[name="repeat"]');

  ifRepeatShowCalendar();
  ifDatesChange();

  function ifRepeatShowCalendar() {
    if ($repeat.val()) {
      $('.repeat-calendar').show();
    } else {
      $('.repeat-calendar').hide();
    }
  }

  function ifDatesChange() {
    var $cancellations = $('.cancellations');
    $cancellations.find('h4').has('input:checkbox:not(:checked)').remove();
    $.post('/upcoming', $form.serialize(), function(data) {
      if (!data.status === 'ok') {
        return;
      }
      $.each(data.dates, function(i, date) {
        if ($cancellations.find('input[value="' + date.value + '"]').length) {
          return;
        }
        var $h4 = $('<h4></h4>');
        var $input = $('<input type="checkbox" name="cancellations[]" />');
        $input.attr('value', date.value);
        $h4.append($input);
        var $span = $('<span></span>');
        $span.text('Cancel ' + date.label);
        $h4.append($span);
        $cancellations.append($h4);
      });
    });
  }
});
