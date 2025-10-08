(function () {
  const modal = document.getElementById('download-modal');
  if (!modal) {
    return;
  }

  const trigger = document.querySelector('[data-download-trigger]');
  if (!trigger) {
    return;
  }

  const overlaySelectors = '[data-download-dismiss]';
  const optionSelector = '[data-download-format]';
  const errorElement = modal.querySelector('[data-download-error]');
  const optionButtons = Array.from(modal.querySelectorAll(optionSelector));

  let isBusy = false;

  const openModal = () => {
    if (isBusy) {
      return;
    }
    modal.classList.add('is-active');
    modal.setAttribute('aria-hidden', 'false');
    const dialog = modal.querySelector('.download-modal__dialog');
    if (dialog) {
      dialog.focus({ preventScroll: true });
    }
  };

  const hideError = () => {
    if (!errorElement) {
      return;
    }
    errorElement.hidden = true;
    errorElement.textContent = '';
  };

  const showError = (message) => {
    if (!errorElement) {
      return;
    }
    errorElement.textContent = message;
    errorElement.hidden = !message;
  };

  const closeModal = () => {
    if (isBusy) {
      return;
    }
    modal.classList.remove('is-active');
    modal.setAttribute('aria-hidden', 'true');
    hideError();
    trigger.focus({ preventScroll: true });
  };

  const setBusyState = (busy) => {
    isBusy = busy;
    optionButtons.forEach((button) => {
      button.disabled = busy;
      button.classList.toggle('is-loading', busy);
    });
    if (busy) {
      hideError();
    }
  };

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    openModal();
  });

  modal.querySelectorAll(overlaySelectors).forEach((element) => {
    element.addEventListener('click', closeModal);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-active')) {
      event.preventDefault();
      closeModal();
    }
  });

  const getSections = () => {
    return Array.from(document.querySelectorAll('[data-download-section]'));
  };

  const replaceClonedCanvases = (original, clone) => {
    const originalCanvases = original.querySelectorAll('canvas');
    const clonedCanvases = clone.querySelectorAll('canvas');

    originalCanvases.forEach((canvas, index) => {
      const clonedCanvas = clonedCanvases[index];
      if (!clonedCanvas) {
        return;
      }
      try {
        const dataUrl = canvas.toDataURL('image/png');
        const image = document.createElement('img');
        image.src = dataUrl;
        image.alt = canvas.getAttribute('aria-label') || canvas.getAttribute('data-label') || 'Chart image';
        image.className = 'download-chart-image';
        clonedCanvas.replaceWith(image);
      } catch (error) {
        console.error('Failed to copy chart canvas for download', error);
      }
    });
  };

  const cloneSection = (section) => {
    const clone = section.cloneNode(true);
    clone.querySelectorAll('[data-download-ignore]').forEach((ignore) => {
      ignore.remove();
    });
    replaceClonedCanvases(section, clone);
    return clone;
  };

  const buildCaptureContainer = (sections) => {
    const container = document.createElement('div');
    container.className = 'download-capture';
    container.setAttribute('aria-hidden', 'true');
    container.style.position = 'fixed';
    container.style.left = '-10000px';
    container.style.top = '0';
    container.style.zIndex = '-1';

    sections.forEach((section) => {
      container.appendChild(cloneSection(section));
    });

    if (sections.length === 1) {
      container.classList.add('download-capture--single');
    }

    document.body.appendChild(container);
    return container;
  };

  const renderCapture = async (sections) => {
    const container = buildCaptureContainer(sections);
    try {
      const scale = Math.min(3, window.devicePixelRatio || 2);
      const canvas = await html2canvas(container, {
        backgroundColor: '#ffffff',
        scale,
        useCORS: true
      });
      return canvas;
    } finally {
      container.remove();
    }
  };

  const downloadAsPng = (canvas) => {
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'dashboard-export.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const downloadAsPdf = async (canvas) => {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('PDF library failed to load');
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'pt', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imageData = canvas.toDataURL('image/png');
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * pageWidth) / canvas.width;

    let position = 0;
    let heightLeft = imgHeight;

    pdf.addImage(imageData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imageData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save('dashboard-export.pdf');
  };

  const handleDownload = async (format) => {
    const sections = getSections();
    if (!sections.length) {
      showError('No dashboard content available to download right now.');
      return;
    }

    setBusyState(true);

    try {
      const canvas = await renderCapture(sections);

      if (format === 'png') {
        downloadAsPng(canvas);
      } else {
        await downloadAsPdf(canvas);
      }

      closeModal();
    } catch (error) {
      console.error('Download export failed', error);
      showError('Unable to generate the download. Please try again in a moment.');
    } finally {
      setBusyState(false);
    }
  };

  optionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const format = button.getAttribute('data-download-format');
      if (format === 'png' || format === 'pdf') {
        handleDownload(format);
      }
    });
  });
})();
